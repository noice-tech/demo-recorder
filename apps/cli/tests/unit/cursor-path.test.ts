import { describe, expect, it } from "vitest";
import { generateCursorPath, targetPointWithinBounds } from "../../src/capture/index.js";

describe("generateCursorPath", () => {
  it("is deterministic, curved, and ends exactly on the target", () => {
    const first = generateCursorPath(
      { x: 0, y: 0 },
      { x: 320, y: 160 },
      { viewport: { width: 1440, height: 900 }, seed: 4 },
    );
    const second = generateCursorPath(
      { x: 0, y: 0 },
      { x: 320, y: 160 },
      { viewport: { width: 1440, height: 900 }, seed: 4 },
    );
    expect(first).toEqual(second);
    expect(first.points.at(-1)).toEqual({ x: 320, y: 160 });
    expect(first.points.length).toBeGreaterThanOrEqual(14);

    const maximumLineError = Math.max(
      ...first.points.map(
        (point) => Math.abs(160 * point.x - 320 * point.y) / Math.hypot(320, 160),
      ),
    );
    expect(maximumLineError).toBeGreaterThan(10);
  });

  it("uses a velocity profile that accelerates and then decelerates", () => {
    const from = { x: 100, y: 100 };
    const path = generateCursorPath(from, { x: 900, y: 500 }, { steps: 30, seed: 2 });
    const points = [from, ...path.points];
    const speeds = points
      .slice(1)
      .map((point, index) => Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y));
    const peak = Math.max(...speeds);
    expect(speeds[0]).toBeLessThan(peak * 0.2);
    expect(speeds.at(-1)).toBeLessThan(peak * 0.2);
  });

  it("keeps generated points inside the viewport", () => {
    const viewport = { width: 1440, height: 900 };
    const path = generateCursorPath({ x: 2, y: 2 }, { x: 1438, y: 4 }, { viewport, seed: 9 });
    expect(
      path.points.every(
        (point) =>
          point.x >= 0 && point.x <= viewport.width && point.y >= 0 && point.y <= viewport.height,
      ),
    ).toBe(true);
  });

  it("respects explicit step and duration settings", () => {
    const path = generateCursorPath(
      { x: 10, y: 20 },
      { x: 30, y: 40 },
      { steps: 2, durationMs: 100 },
    );
    expect(path).toEqual({
      durationMs: 100,
      points: [
        { x: 20, y: 30 },
        { x: 30, y: 40 },
      ],
    });
  });

  it("handles a zero-distance movement", () => {
    expect(generateCursorPath({ x: 20, y: 30 }, { x: 20, y: 30 }, { steps: 2 }).points).toEqual([
      { x: 20, y: 30 },
      { x: 20, y: 30 },
    ]);
  });
});

describe("targetPointWithinBounds", () => {
  it("selects a deterministic non-centered point within the visible target", () => {
    const bounds = { x: 100, y: 200, width: 240, height: 100 };
    const viewport = { width: 1440, height: 900 };
    const first = targetPointWithinBounds(bounds, viewport, 3);
    expect(first).toEqual(targetPointWithinBounds(bounds, viewport, 3));
    expect(first).not.toEqual({ x: 220, y: 250 });
    expect(first.x).toBeGreaterThan(bounds.x);
    expect(first.x).toBeLessThan(bounds.x + bounds.width);
    expect(first.y).toBeGreaterThan(bounds.y);
    expect(first.y).toBeLessThan(bounds.y + bounds.height);
  });

  it("uses only the visible portion of a clipped target", () => {
    const point = targetPointWithinBounds(
      { x: -100, y: 850, width: 160, height: 100 },
      { width: 1440, height: 900 },
      1,
    );
    expect(point.x).toBeGreaterThanOrEqual(0);
    expect(point.x).toBeLessThanOrEqual(60);
    expect(point.y).toBeGreaterThanOrEqual(850);
    expect(point.y).toBeLessThanOrEqual(900);
  });
});
