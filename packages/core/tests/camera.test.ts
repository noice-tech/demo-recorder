import { describe, expect, it } from "vitest";
import { cameraStateAt, type ZoomSegment } from "../src/index.js";

const segment: ZoomSegment = {
  startMs: 100,
  endMs: 1100,
  focusX: 1000,
  focusY: 0,
  scale: 1.5,
};

const stateAt = (
  timestampMs: number,
  overrides: Partial<Parameters<typeof cameraStateAt>[0]> = {},
) =>
  cameraStateAt({
    timestampMs,
    segments: [segment],
    viewport: { width: 1000, height: 500 },
    contentRect: { x: 100, y: 200, width: 800, height: 400 },
    enterDurationMs: 200,
    exitDurationMs: 300,
    ...overrides,
  });

describe("cameraStateAt", () => {
  it("returns a centered neutral camera outside zoom segments", () => {
    expect(stateAt(0)).toEqual({ scale: 1, originX: 500, originY: 400 });
  });

  it("projects and clamps the focal point into the content rectangle", () => {
    expect(stateAt(500)).toMatchObject({ scale: 1.5, originX: 900, originY: 200 });
  });

  it("smoothly enters, holds, and exits", () => {
    expect(stateAt(100).scale).toBe(1);
    expect(stateAt(200).scale).toBe(1.25);
    expect(stateAt(300).scale).toBe(1.5);
    expect(stateAt(800).scale).toBe(1.5);
    expect(stateAt(950).scale).toBe(1.25);
    expect(stateAt(1100).scale).toBe(1);
  });

  it("proportionally shortens transitions when they exceed segment duration", () => {
    const shortSegment = { ...segment, startMs: 0, endMs: 100 };
    expect(
      stateAt(50, {
        segments: [shortSegment],
        enterDurationMs: 100,
        exitDurationMs: 100,
      }).scale,
    ).toBe(1.5);
    expect(
      stateAt(100, {
        segments: [shortSegment],
        enterDurationMs: 100,
        exitDurationMs: 100,
      }).scale,
    ).toBe(1);
  });
});
