import { describe, expect, it } from "vitest";
import { revealTarget, type Rect, type RevealSurface } from "../../src/motion/reveal.js";

const viewport = { width: 1440, height: 900 };
const target = { role: "button", name: "Launch project" };

/**
 * A page whose content moves by the scrolled distance. Like a smooth wheel
 * scroll, the move shows up only after `lagReads` reads of the old position.
 */
function fakePage(
  initial: Rect,
  options: { maxScrollY?: number; lagReads?: number; vanishOnScroll?: boolean } = {},
) {
  let shownY = 0;
  let scrollY = 0;
  let lag = 0;
  let vanished = false;
  const scrolls: number[] = [];
  const surface: RevealSurface = {
    bounds: () => {
      if (vanished) {
        return Promise.resolve(undefined);
      }
      if (lag > 0) {
        lag -= 1;
      } else {
        shownY = scrollY;
      }
      return Promise.resolve({ ...initial, y: initial.y - shownY });
    },
    scroll: (_deltaX, deltaY) => {
      scrolls.push(deltaY);
      scrollY = Math.min(options.maxScrollY ?? Infinity, scrollY + deltaY);
      lag = options.lagReads ?? 0;
      vanished = options.vanishOnScroll ?? false;
      return Promise.resolve();
    },
    wait: () => Promise.resolve(),
  };
  return { surface, scrolls };
}

describe("revealTarget", () => {
  it.each([
    { case: "a visible target near the top", y: 19, height: 45, scroll: [] },
    { case: "a visible target touching the bottom", y: 850, height: 50, scroll: [] },
    // Bottom at 1070 lands on the 15% bottom margin: 900 - 135 = 765.
    { case: "a target below the fold", y: 1019, height: 51, scroll: [305] },
    { case: "a target above the viewport", y: -200, height: 40, scroll: [-335] },
    { case: "a target taller than the comfortable area", y: 1000, height: 800, scroll: [865] },
  ])("scrolls $case only as far as needed", async ({ y, height, scroll }) => {
    const page = fakePage({ x: 100, y, width: 190, height });
    const bounds = await revealTarget(page.surface, target, viewport);
    expect(page.scrolls).toEqual(scroll);
    const deltaY = scroll[0] ?? 0;
    expect(bounds).toEqual({ x: 100, y: y - deltaY, width: 190, height });
  });

  it("returns where a lagging scroll settles, not where it started", async () => {
    const page = fakePage({ x: 1155, y: 1019, width: 190, height: 51 }, { lagReads: 3 });
    await expect(revealTarget(page.surface, target, viewport)).resolves.toEqual({
      x: 1155,
      y: 714,
      width: 190,
      height: 51,
    });
  });

  it.each([
    {
      case: "the page cannot scroll it into view",
      bounds: { x: 100, y: 1200, width: 190, height: 51 },
      options: { maxScrollY: 0 },
      error:
        /button "Launch project" is outside the 1440x900 viewport \(center 195,1226\) after scrolling\. Add a scroll step/,
    },
    {
      case: "it sits beside the viewport",
      bounds: { x: 1600, y: 100, width: 100, height: 40 },
      options: {},
      error:
        /button "Launch project" is outside the 1440x900 viewport \(center 1650,120\)\. Add a scroll step/,
    },
    {
      case: "it disappears while scrolling",
      bounds: { x: 100, y: 1200, width: 190, height: 51 },
      options: { vanishOnScroll: true },
      error: /button "Launch project" disappeared while scrolling into view/,
    },
  ])("fails before the cursor moves when $case", async ({ bounds, options, error }) => {
    await expect(revealTarget(fakePage(bounds, options).surface, target, viewport)).rejects.toThrow(
      error,
    );
  });

  it("leaves a target without a box to the action", async () => {
    const page = fakePage({ x: 0, y: 0, width: 0, height: 0 }, { vanishOnScroll: true });
    const surface = { ...page.surface, bounds: () => Promise.resolve(undefined) };
    await expect(revealTarget(surface, target, viewport)).resolves.toBeUndefined();
    expect(page.scrolls).toEqual([]);
  });
});
