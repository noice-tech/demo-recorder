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
  it("does not zoom for an isolated click", () => {
    expect(generateZoomSegments([click(200, 100, 200)], 800, defaultConfig.zoom)).toEqual([]);
  });

  it("returns no segments when disabled, empty, or duration is zero", () => {
    expect(generateZoomSegments([], 1000, { ...defaultConfig.zoom, enabled: false })).toEqual([]);
    expect(generateZoomSegments([], 1000, defaultConfig.zoom)).toEqual([]);
    expect(generateZoomSegments([click(0, 10, 10)], 0, defaultConfig.zoom)).toEqual([]);
  });

  it("keeps nearby activity joined while changing focal areas", () => {
    const config = {
      ...defaultConfig.zoom,
      clickClusterRadiusPx: 10,
      clickClusterWindowMs: 1000,
      paddingBeforeMs: 100,
      paddingAfterMs: 100,
    };
    const segments = generateZoomSegments(
      [click(1000, 100, 100), click(1900, 500, 500)],
      3000,
      config,
    );

    expect(segments).toHaveLength(2);
    expect(segments[0]?.endMs).toBe(1450);
    expect(segments[1]?.startMs).toBe(1450);
    expect(segments.map(({ focusX, focusY }) => [focusX, focusY])).toEqual([
      [100, 100],
      [500, 500],
    ]);
  });
});
