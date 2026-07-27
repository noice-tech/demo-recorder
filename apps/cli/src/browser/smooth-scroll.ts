import type { Page } from "playwright";

const SCROLL_SAMPLE_RATE = 60;
const MIN_SCROLL_DURATION_MS = 320;
const MAX_SCROLL_DURATION_MS = 3_000;
const SCROLL_DISTANCE_PER_MS = 4;
const MOMENTUM_DECAY = 5;
const FINAL_PAINT_DELAY_MS = 1000 / SCROLL_SAMPLE_RATE;

export type ScrollDelta = { deltaX: number; deltaY: number };

export type ScrollGesture = {
  deltas: ScrollDelta[];
  durationMs: number;
};

type SmoothScrollOptions = {
  durationMs?: number;
  now?: () => number;
};

function validateDelta(value: number): void {
  if (!Number.isFinite(value)) throw new Error("Scroll deltas must be finite");
}

/**
 * Returns the default gesture duration. Larger distances remain fast enough for
 * demos while receiving enough frames to avoid a single large wheel jump.
 */
export function scrollDurationMs(deltaY: number, deltaX = 0): number {
  validateDelta(deltaX);
  validateDelta(deltaY);
  const distance = Math.hypot(deltaX, deltaY);
  if (distance === 0) return 0;
  return Math.min(
    MAX_SCROLL_DURATION_MS,
    Math.max(
      MIN_SCROLL_DURATION_MS,
      Math.round(MIN_SCROLL_DURATION_MS + distance / SCROLL_DISTANCE_PER_MS),
    ),
  );
}

/**
 * Builds a trackpad-like wheel gesture. Its velocity rises quickly, peaks early,
 * and then decays for longer than it accelerated, approximating momentum
 * scrolling without relying on host operating-system input APIs.
 */
export function generateScrollGesture(
  deltaY: number,
  deltaX = 0,
  options: Pick<SmoothScrollOptions, "durationMs"> = {},
): ScrollGesture {
  validateDelta(deltaX);
  validateDelta(deltaY);
  if (
    options.durationMs !== undefined &&
    (!Number.isFinite(options.durationMs) || options.durationMs <= 0)
  )
    throw new Error("Scroll duration must be a finite positive number");

  const distance = Math.hypot(deltaX, deltaY);
  if (distance === 0) return { deltas: [], durationMs: 0 };

  const durationMs = options.durationMs ?? scrollDurationMs(deltaY, deltaX);
  const sampleCount = Math.max(2, Math.ceil((durationMs / 1000) * SCROLL_SAMPLE_RATE));
  const normalization = 1 - (1 + MOMENTUM_DECAY) * Math.exp(-MOMENTUM_DECAY);
  const deltas: ScrollDelta[] = [];
  let previousProgress = 0;
  let emittedX = 0;
  let emittedY = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const time = (index + 1) / sampleCount;
    const progress =
      (1 - (1 + MOMENTUM_DECAY * time) * Math.exp(-MOMENTUM_DECAY * time)) / normalization;
    const progressDelta = progress - previousProgress;
    const isLast = index === sampleCount - 1;
    const nextX = isLast ? deltaX - emittedX : deltaX * progressDelta;
    const nextY = isLast ? deltaY - emittedY : deltaY * progressDelta;
    deltas.push({ deltaX: nextX, deltaY: nextY });
    emittedX += nextX;
    emittedY += nextY;
    previousProgress = progress;
  }

  return { deltas, durationMs };
}

/** Executes a deterministic, cross-platform momentum gesture with real wheel events. */
export async function smoothScroll(
  page: Page,
  deltaY: number,
  deltaX = 0,
  options: SmoothScrollOptions = {},
): Promise<void> {
  const gesture = generateScrollGesture(deltaY, deltaX, options);
  if (gesture.deltas.length === 0) return;

  const now = options.now ?? (() => performance.now());
  const startedAtMs = now();
  const finalIndex = gesture.deltas.length - 1;

  for (const [index, delta] of gesture.deltas.entries()) {
    const scheduledAtMs =
      startedAtMs + (finalIndex === 0 ? 0 : (gesture.durationMs * index) / finalIndex);
    const delayMs = scheduledAtMs - now();
    if (delayMs > 0) await page.waitForTimeout(delayMs);
    await page.mouse.wheel(delta.deltaX, delta.deltaY);
  }

  // Playwright does not wait for the final wheel event to produce a painted frame.
  await page.waitForTimeout(FINAL_PAINT_DELAY_MS);
}
