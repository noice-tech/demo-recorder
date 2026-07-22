import type { InteractionTarget } from "@noice-tech/demo-recorder-core";
import type { Locator, Page } from "playwright";
import type { InteractionTracker } from "./interaction-tracker.js";
import type {
  ClickOptions,
  DemoActions,
  FillOptions,
  MoveOptions,
  WaitForOptions,
} from "./types.js";

export type CursorState = { x: number; y: number };

type ActionContext = {
  page: Page;
  tracker: InteractionTracker;
  cursor: CursorState;
  baseUrl?: string;
};

type ResolvedTarget = {
  x: number;
  y: number;
  target: InteractionTarget;
};

async function resolveTarget(locator: Locator): Promise<ResolvedTarget> {
  await locator.waitFor({ state: "visible" });
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error("Interaction target has no visible bounding box");

  const semantics = await locator.evaluate((element) => {
    const htmlElement = element as HTMLElement;
    const implicitRole =
      htmlElement.tagName === "BUTTON"
        ? "button"
        : htmlElement.tagName === "A"
          ? "link"
          : htmlElement.tagName === "INPUT"
            ? "textbox"
            : undefined;
    const role = htmlElement.getAttribute("role") ?? implicitRole;
    const name =
      htmlElement.getAttribute("aria-label") ??
      htmlElement.getAttribute("title") ??
      htmlElement.textContent?.trim().replace(/\s+/g, " ") ??
      undefined;
    return { role, name: name?.slice(0, 200) };
  });

  const target: InteractionTarget = { bounds };
  if (semantics.role) target.role = semantics.role;
  if (semantics.name) target.name = semantics.name;

  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
    target,
  };
}

export function generateCursorPath(
  from: CursorState,
  to: CursorState,
  options: MoveOptions = {},
): { points: CursorState[]; durationMs: number } {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = options.steps ?? Math.max(14, Math.min(52, Math.round(distance / 16)));
  const durationMs =
    options.durationMs ?? Math.max(280, Math.min(950, Math.round(distance * 0.95)));
  const points = Array.from({ length: steps }, (_, index) => {
    const progress = (index + 1) / steps;
    const eased = 1 - (1 - progress) * (1 - progress);
    return {
      x: from.x + (to.x - from.x) * eased,
      y: from.y + (to.y - from.y) * eased,
    };
  });
  return { points, durationMs };
}

async function moveToPoint(
  context: ActionContext,
  point: CursorState,
  options: MoveOptions = {},
): Promise<void> {
  const { points, durationMs } = generateCursorPath(context.cursor, point, options);
  const delayMs = points.length > 1 ? durationMs / points.length : 0;
  for (const next of points) {
    await context.page.mouse.move(next.x, next.y);
    context.tracker.push({ type: "cursor-move", x: next.x, y: next.y });
    if (delayMs > 0) await context.page.waitForTimeout(delayMs);
  }
  context.cursor.x = point.x;
  context.cursor.y = point.y;
}

async function moveTo(
  context: ActionContext,
  locator: Locator,
  options?: MoveOptions,
): Promise<void> {
  const target = await resolveTarget(locator);
  await moveToPoint(context, target, options);
}

async function click(
  context: ActionContext,
  locator: Locator,
  options: ClickOptions = {},
): Promise<void> {
  const resolved = await resolveTarget(locator);
  await moveToPoint(context, resolved, options);
  const button = options.button ?? "left";

  await context.page.mouse.down({ button });
  await context.page.waitForTimeout(options.delayMs ?? 90);
  await context.page.mouse.up({ button });
  context.tracker.push({
    type: "click",
    x: resolved.x,
    y: resolved.y,
    button,
    target: resolved.target,
  });
}

async function fill(
  context: ActionContext,
  locator: Locator,
  value: string,
  options: FillOptions = {},
): Promise<void> {
  await click(context, locator, {
    ...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
    ...(options.steps === undefined ? {} : { steps: options.steps }),
  });
  await locator.fill(value);
  if (options.delayMs && options.delayMs > 0) await context.page.waitForTimeout(options.delayMs);
}

async function press(
  context: ActionContext,
  locator: Locator,
  key: string,
  options?: MoveOptions,
): Promise<void> {
  await moveTo(context, locator, options);
  await locator.press(key);
}

async function select(
  context: ActionContext,
  locator: Locator,
  value: string,
  options?: MoveOptions,
): Promise<void> {
  await moveTo(context, locator, options);
  await locator.selectOption(value);
}

async function scroll(context: ActionContext, deltaY: number, deltaX = 0): Promise<void> {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY))
    throw new Error("Scroll deltas must be finite");
  await context.page.mouse.wheel(deltaX, deltaY);
}

async function waitFor(locator: Locator, options: WaitForOptions = {}): Promise<void> {
  try {
    await locator.waitFor({
      state: "visible",
      ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
    });
  } catch (error) {
    throw new Error("Timed out waiting for interaction target", { cause: error });
  }
}

async function waitForUrl(
  context: ActionContext,
  urlPattern: string,
  options?: WaitForOptions,
): Promise<void> {
  const waitOptions = options?.timeoutMs === undefined ? {} : { timeout: options.timeoutMs };
  await context.page.waitForURL(urlPattern, waitOptions);
}

async function wait(page: Page, durationMs: number): Promise<void> {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new Error("Wait duration must be a finite nonnegative number");
  }
  await page.waitForTimeout(durationMs);
}

async function goto(context: ActionContext, url: string): Promise<void> {
  let destination: string;
  try {
    destination = context.baseUrl ? new URL(url, context.baseUrl).href : new URL(url).href;
  } catch (error) {
    throw new Error(`Cannot resolve navigation URL: ${url}`, { cause: error });
  }

  try {
    await context.page.goto(destination, { waitUntil: "domcontentloaded" });
  } catch (error) {
    throw new Error(`Navigation failed: ${destination}`, { cause: error });
  }
}

export function createActions(context: ActionContext): DemoActions {
  return {
    goto: (url) => goto(context, url),
    moveTo: (locator, options) => moveTo(context, locator, options),
    click: (locator, options) => click(context, locator, options),
    fill: (locator, value, options) => fill(context, locator, value, options),
    press: (locator, key, options) => press(context, locator, key, options),
    select: (locator, value, options) => select(context, locator, value, options),
    scroll: (deltaY, deltaX) => scroll(context, deltaY, deltaX),
    waitFor: (locator, options) => waitFor(locator, options),
    waitForUrl: (urlPattern, options) => waitForUrl(context, urlPattern, options),
    wait: (durationMs) => wait(context.page, durationMs),
  };
}
