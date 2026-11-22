import { describeTarget, type Action, type Target } from "@noice-tech/demo-recorder-core";
import { settleAfterChange } from "../support/settle.js";

export type Rect = { x: number; y: number; width: number; height: number };
export type Viewport = { width: number; height: number };

/** Minimal surface reveal needs; keeps this module free of Playwright types. */
export type RevealSurface = {
  bounds(target: Target): Promise<Rect | undefined>;
  /** Whether the target is in the page now, without waiting for it. */
  present(target: Target): Promise<boolean>;
  scroll(deltaX: number, deltaY: number): Promise<void>;
  scrollY(): Promise<number>;
  wait(durationMs: number): Promise<void>;
};

/** Share of the viewport height kept clear above or below a target scrolled into view. */
const REVEAL_MARGIN_RATIO = 0.15;
const SETTLE_TOLERANCE_PX = 0.5;
/** A scroll-to moves at most this share of the viewport at once, so viewers can follow. */
const SEGMENT_RATIO = 0.8;
const MAX_SEGMENTS = 40;

/** The element a plan action moves the cursor to, if any. */
export function actionTarget(action: Action): Target | undefined {
  if (action.type === "navigate" || action.type === "scroll" || action.type === "hold") {
    return undefined;
  }
  return "target" in action ? action.target : undefined;
}

/**
 * Vertical scroll that brings a target into view the way a presenter would:
 * nothing when it is already fully visible, otherwise the smallest scroll that
 * leaves a comfortable margin. A target taller than the comfortable area is
 * aligned to the top margin.
 */
function revealDeltaY(bounds: Rect, viewport: Viewport, marginRatio = REVEAL_MARGIN_RATIO): number {
  const top = bounds.y;
  const bottom = bounds.y + bounds.height;
  if (top >= 0 && bottom <= viewport.height) {
    return 0;
  }
  const margin = Math.round(viewport.height * marginRatio);
  if (bounds.height > viewport.height - 2 * margin) {
    return Math.round(top - margin);
  }
  if (bottom > viewport.height) {
    return Math.round(bottom - (viewport.height - margin));
  }
  return Math.round(top - margin);
}

/** The recording schema accepts interaction coordinates on [0, size] in both axes. */
function centerInViewport(bounds: Rect, viewport: Viewport): boolean {
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  return x >= 0 && x <= viewport.width && y >= 0 && y <= viewport.height;
}

function sameRect(left: Rect, right: Rect): boolean {
  return (
    Math.abs(left.x - right.x) <= SETTLE_TOLERANCE_PX &&
    Math.abs(left.y - right.y) <= SETTLE_TOLERANCE_PX &&
    Math.abs(left.width - right.width) <= SETTLE_TOLERANCE_PX &&
    Math.abs(left.height - right.height) <= SETTLE_TOLERANCE_PX
  );
}

/**
 * Scrolls a target into view before the cursor travels to it, so the capture
 * shows a deliberate scroll instead of an instant jump, and every interaction
 * coordinate stays inside the viewport. Returns the settled bounds, or
 * undefined when the target has no box (the action reports that itself).
 */
export async function revealTarget(
  surface: RevealSurface,
  target: Target,
  viewport: Viewport,
): Promise<Rect | undefined> {
  const initial = await surface.bounds(target);
  if (!initial) {
    return undefined;
  }

  const deltaY = revealDeltaY(initial, viewport);
  let bounds: Rect | undefined = initial;
  if (deltaY !== 0) {
    await surface.scroll(0, deltaY);
    // A target that never moves (for example, inside a nested scroll container)
    // times out where it is and fails the viewport check below.
    bounds = await settleAfterChange({
      before: initial,
      read: () => surface.bounds(target),
      same: sameRect,
      wait: (durationMs) => surface.wait(durationMs),
    });
    if (!bounds) {
      throw new Error(`${describeTarget(target)} disappeared while scrolling into view`);
    }
  }

  if (!centerInViewport(bounds, viewport)) {
    const x = Math.round(bounds.x + bounds.width / 2);
    const y = Math.round(bounds.y + bounds.height / 2);
    throw new Error(
      `${describeTarget(target)} is outside the ${viewport.width}x${viewport.height} viewport` +
        ` (center ${x},${y})${deltaY === 0 ? "" : " after scrolling"}. Add a scroll step before` +
        " this step, or choose a target the page can scroll into view.",
    );
  }
  return bounds;
}

/**
 * Scrolls in segments until a target sits near the top of the viewport. It
 * measures again after every segment, because lazy pages add content as they
 * scroll and the target itself may render only once it is near.
 */
export async function scrollToTarget(
  surface: RevealSurface,
  target: Target,
  viewport: Viewport,
): Promise<void> {
  const segment = Math.round(viewport.height * SEGMENT_RATIO);
  const margin = Math.round(viewport.height * REVEAL_MARGIN_RATIO);
  for (let index = 0; index < MAX_SEGMENTS; index += 1) {
    const bounds = (await surface.present(target)) ? await surface.bounds(target) : undefined;
    const remaining = bounds ? Math.round(bounds.y - margin) : segment;
    if (bounds && Math.abs(remaining) <= 1) {
      return;
    }

    const before = await surface.scrollY();
    await surface.scroll(0, Math.max(-segment, Math.min(segment, remaining)));
    const after = await settleAfterChange({
      before,
      read: () => surface.scrollY(),
      same: (left, right) => Math.abs(left - right) <= SETTLE_TOLERANCE_PX,
      wait: (durationMs) => surface.wait(durationMs),
    });
    if (after === undefined || Math.abs(after - before) > SETTLE_TOLERANCE_PX) {
      continue;
    }

    // The page cannot scroll further: near its end, a visible target is enough.
    const last = (await surface.present(target)) ? await surface.bounds(target) : undefined;
    if (last && centerInViewport(last, viewport)) {
      return;
    }
    throw new Error(
      last
        ? `${describeTarget(target)} cannot be scrolled into view`
        : `${describeTarget(target)} did not appear while scrolling to the end of the page`,
    );
  }
  throw new Error(`${describeTarget(target)} is more than ${MAX_SEGMENTS} scroll segments away`);
}
