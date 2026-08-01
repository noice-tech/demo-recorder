import { describe, expect, it } from "vitest";
import type { ProductDemoRenderInput } from "../src/index.js";
import {
  buildProductDemoFilterGraph,
  generateTimedOverlayScript,
  productDemoGeometry,
} from "../src/index.js";

const input: ProductDemoRenderInput = {
  sourcePath: "/recording/browser.webm",
  recording: {
    version: 1,
    id: "fixture",
    createdAt: "2026-07-26T00:00:00.000Z",
    durationMs: 2000,
    viewport: { width: 1440, height: 900 },
    video: { path: "browser.webm", width: 1440, height: 900, durationMs: 2000 },
    events: [
      { type: "navigation", timestampMs: 0, url: "https://example.com/a{b}" },
      { type: "cursor-move", timestampMs: 0, x: 100, y: 200 },
      { type: "click", timestampMs: 500, x: 400, y: 300, button: "left" },
      { type: "cursor-move", timestampMs: 1000, x: 800, y: 600 },
    ],
  },
  timeline: {
    trimStartMs: 250,
    trimEndMs: 1750,
    zoomSegments: [{ startMs: 400, endMs: 1200, focusX: 400, focusY: 300, scale: 1.35 }],
  },
  config: {
    width: 1920,
    height: 1080,
    fps: 30,
    padding: 97.2,
    cursorEnabled: true,
    zoom: { enterDurationMs: 350, exitDurationMs: 450 },
  },
};

describe("product demo graph generation", () => {
  it("uses the established geometry, frame count, and trim range", () => {
    expect(productDemoGeometry(input.recording.viewport, input.config)).toEqual({
      content: { x: 290, y: 145, width: 1340, height: 838 },
      browser: { x: 290, y: 97, width: 1340, height: 886 },
    });
    const graph = buildProductDemoFilterGraph(input);
    expect(graph.frameCount).toBe(45);
    expect(graph.durationMs).toBe(1500);
    expect(graph.script).toContain("trim=start=0.25:end=1.75");
  });

  it("computes geometry for square output and configurable padding", () => {
    expect(
      productDemoGeometry(input.recording.viewport, {
        ...input.config,
        width: 1080,
        height: 1080,
        padding: 72,
      }),
    ).toEqual({
      content: { x: 72, y: 272, width: 936, height: 586 },
      browser: { x: 72, y: 224, width: 936, height: 634 },
    });
  });

  it("emits frame-sampled cursor and click drawings with safe title text", () => {
    const geometry = productDemoGeometry(input.recording.viewport, input.config);
    const overlayScript = generateTimedOverlayScript({
      composition: {
        recording: input.recording,
        timeline: input.timeline,
        config: input.config,
      },
      geometry,
      frameCount: 45,
    });
    expect(overlayScript).toContain("https://example.com/a｛b｝");
    expect(overlayScript).not.toContain("https://example.com/a{b}");
  });
});
