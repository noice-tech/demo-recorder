import { describe, expect, it } from "vitest";
import type { ProductDemoRenderInput } from "../src/index.js";
import {
  buildCameraExpressions,
  buildProductDemoFilterGraph,
  generateTimedOverlayScript,
  productDemoGeometry,
  renderProductDemo,
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
    cursorEnabled: true,
    zoom: { enterDurationMs: 350, exitDurationMs: 450 },
  },
};

describe("product demo graph generation", () => {
  it("uses the established ceil frame count and one-process graph", () => {
    const graph = buildProductDemoFilterGraph(input);
    expect(graph.frameCount).toBe(45);
    expect(graph.durationMs).toBe(1500);
    expect(graph.script).toContain("trim=start=0.25:end=1.75");
    expect(graph.script).toContain("ass=filename=timed-overlays.subtitle:fontsdir=fonts:alpha=1");
    expect(graph.script).toContain("eval=frame");
    expect(graph.script).toContain("format=yuv420p[output]");
  });

  it("generates piecewise smooth-step camera expressions around projected origins", () => {
    const geometry = productDemoGeometry(input.recording.viewport, input.config);
    const camera = buildCameraExpressions({
      timeline: input.timeline,
      viewport: input.recording.viewport,
      geometry,
      output: input.config,
      enterDurationMs: input.config.zoom.enterDurationMs,
      exitDurationMs: input.config.zoom.exitDurationMs,
    });
    expect(camera.scale).toContain("between((t+0.25),0.4,1.2)");
    expect(camera.scale).toContain("pow(");
    expect(camera.originX).toContain("662.22");
    expect(camera.scaledWidth).toContain("trunc(1920");
  });

  it("rejects output dimensions outside the version 1 contract", async () => {
    await expect(
      renderProductDemo(
        { ...input, config: { ...input.config, width: 1280, height: 720 } },
        { outputPath: "/unused.mp4", assetsDirectory: "/unused" },
      ),
    ).rejects.toThrow("only 1920x1080");
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
    expect(overlayScript).toContain("Style: Title,Inter,14");
    expect(overlayScript).toContain("https://example.com/a｛b｝");
    expect(overlayScript).toContain("\\p1\\bord1.8");
    expect(overlayScript).toContain("&H00CDF08C&");
    expect(overlayScript).not.toContain("https://example.com/a{b}");
  });
});
