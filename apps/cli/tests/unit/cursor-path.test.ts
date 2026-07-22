import { describe, expect, it } from "vitest";
import { generateCursorPath } from "../../src/capture/index.js";

describe("generateCursorPath", () => {
  it("is deterministic and ends exactly on the target", () => {
    const first = generateCursorPath({ x: 0, y: 0 }, { x: 320, y: 160 });
    const second = generateCursorPath({ x: 0, y: 0 }, { x: 320, y: 160 });
    expect(first).toEqual(second);
    expect(first.points.at(-1)).toEqual({ x: 320, y: 160 });
    expect(first.points.length).toBeGreaterThanOrEqual(14);
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
        { x: 25, y: 35 },
        { x: 30, y: 40 },
      ],
    });
  });
});
