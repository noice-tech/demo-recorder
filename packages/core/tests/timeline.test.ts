import { describe, expect, it } from "vitest";
import { buildTimeline, resolveTrim, resolveZoomWindows, type Recording } from "../src/index.js";

const recording: Recording = {
  version: 1,
  id: "timeline-fixture",
  createdAt: "2026-07-11T10:00:00.000Z",
  durationMs: 5000,
  viewport: { width: 1000, height: 500 },
  guarded: true,
  cursor: "synthetic",
  video: { path: "browser.mp4", width: 1000, height: 500 },
  events: [
    { type: "navigation", timestampMs: 100, step: 1, url: "https://example.test/" },
    { type: "cursor-move", timestampMs: 120, step: 1, x: 90, y: 90 },
    { type: "click", timestampMs: 200, step: 1, x: 100, y: 100, button: "left" },
    { type: "click", timestampMs: 1000, step: 2, x: 500, y: 400, button: "left" },
    { type: "key-press", timestampMs: 2000, step: 3, keys: ["Meta", "K"] },
    { type: "click", timestampMs: 3000, step: 4, x: 900, y: 100, button: "left" },
  ],
};

describe("resolveZoomWindows", () => {
  it("anchors a single-step zoom with lead and hold", () => {
    expect(
      resolveZoomWindows([{ step: 1, leadMs: 50, holdMs: 100, scale: 1.8 }], recording),
    ).toEqual([{ startMs: 150, endMs: 300, focusX: 100, focusY: 100, scale: 1.8 }]);
  });

  it("spans a range from its first to its last step", () => {
    expect(resolveZoomWindows([{ fromStep: 1, toStep: 2, scale: 1.5 }], recording)).toEqual([
      { startMs: 200, endMs: 1000, focusX: 100, focusY: 100, scale: 1.5 },
    ]);
  });

  it("clamps the start to the recording and falls back to the viewport center", () => {
    expect(
      resolveZoomWindows([{ step: 3, leadMs: 500, holdMs: 100, scale: 1.4 }], recording),
    ).toEqual([{ startMs: 1500, endMs: 2100, focusX: 500, focusY: 250, scale: 1.4 }]);
  });

  it("fails clearly when an anchor step has no events", () => {
    expect(() => resolveZoomWindows([{ step: 9, scale: 2 }], recording)).toThrow(
      "step 9 has no recorded events",
    );
  });

  it("refuses overlapping zooms", () => {
    expect(() =>
      resolveZoomWindows(
        [
          { step: 1, holdMs: 2000, scale: 1.5 },
          { step: 2, holdMs: 100, scale: 1.5 },
        ],
        recording,
      ),
    ).toThrow("must not overlap");
  });

  it("refuses a reversed range", () => {
    expect(() => resolveZoomWindows([{ fromStep: 3, toStep: 1, scale: 1.5 }], recording)).toThrow(
      "precede",
    );
  });
});

describe("resolveTrim and buildTimeline", () => {
  it("defaults to the full recording", () => {
    expect(resolveTrim(undefined, recording)).toEqual({ startMs: 0, endMs: 5000 });
    expect(buildTimeline(undefined, recording)).toEqual({ zoomSegments: [] });
  });

  it("resolves edge and step anchors into a trim range", () => {
    const trim = { from: { anchor: "start" as const }, to: { anchor: "end" as const } };
    expect(resolveTrim(trim, recording)).toEqual({ startMs: 0, endMs: 5000 });
    expect(resolveTrim({ from: { step: 1 }, to: { step: 4, offsetMs: 400 } }, recording)).toEqual({
      startMs: 200,
      endMs: 3400,
    });
  });

  it("rejects a trim range that leaves the recording", () => {
    expect(() =>
      resolveTrim({ from: { step: 4 }, to: { step: 4, offsetMs: -5000 } }, recording),
    ).toThrow("outside the recording timeline");
  });

  it("omits default trim bounds from the renderer timeline", () => {
    expect(
      buildTimeline(
        {
          version: 1,
          trim: { from: { step: 1 }, to: { step: 2, offsetMs: 200 } },
          zooms: [{ step: 1, holdMs: 100, scale: 1.5 }],
        },
        recording,
      ),
    ).toEqual({
      zoomSegments: [{ startMs: 200, endMs: 300, focusX: 100, focusY: 100, scale: 1.5 }],
      trimStartMs: 200,
      trimEndMs: 1200,
    });
  });
});
