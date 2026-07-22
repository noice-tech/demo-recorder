import { describe, expect, it } from "vitest";
import { defaultConfig, generateZoomSegments, type RecordingEvent } from "../src/index.js";

const click = (timestampMs: number, x: number, y: number): RecordingEvent => ({
  type: "click",
  timestampMs,
  x,
  y,
  button: "left",
});

describe("generateZoomSegments", () => {
  it("pads and clamps deterministic click-derived segments", () => {
    expect(generateZoomSegments([click(200, 100, 200)], 800, defaultConfig.zoom)).toEqual([
      {
        startMs: 0,
        endMs: 800,
        focusX: 100,
        focusY: 200,
        scale: defaultConfig.zoom.zoomScale,
      },
    ]);
  });

  it("returns no segments when disabled, empty, or duration is zero", () => {
    expect(generateZoomSegments([], 1000, { ...defaultConfig.zoom, enabled: false })).toEqual([]);
    expect(generateZoomSegments([], 1000, defaultConfig.zoom)).toEqual([]);
    expect(generateZoomSegments([click(0, 10, 10)], 0, defaultConfig.zoom)).toEqual([]);
  });

  it("splits overlapping padding between distinct focal segments", () => {
    const config = {
      ...defaultConfig.zoom,
      clickClusterRadiusPx: 10,
      clickClusterWindowMs: 1000,
      paddingBeforeMs: 300,
      paddingAfterMs: 500,
    };
    const segments = generateZoomSegments(
      [click(1000, 100, 100), click(1400, 500, 500)],
      3000,
      config,
    );

    expect(segments).toHaveLength(2);
    expect(segments[0]?.endMs).toBe(1300);
    expect(segments[1]?.startMs).toBe(1300);
    expect(segments.map(({ focusX, focusY }) => [focusX, focusY])).toEqual([
      [100, 100],
      [500, 500],
    ]);
  });
});
