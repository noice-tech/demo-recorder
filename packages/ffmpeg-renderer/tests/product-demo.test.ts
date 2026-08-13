import { describe, expect, it } from "vitest";
import { resolveBackground } from "@noice-tech/demo-recorder-core";
import type { ProductDemoRenderInput } from "../src/index.js";
import {
  buildProductDemoFilterGraph,
  generateKeyboardOverlayScript,
  generateTimedOverlayScript,
  keyDisplayLabel,
  keyOverlayIntervals,
  productDemoGeometry,
} from "../src/index.js";

const input: ProductDemoRenderInput = {
  sourcePath: "/recording/browser.webm",
  recording: {
    version: 2,
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
      { type: "key-press", timestampMs: 1200, keys: ["Meta", "K"] },
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
    paddingMode: "minimum",
    background: resolveBackground({ type: "preset", name: "midnight" }),
    browserFrameTheme: "dark",
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
    expect(graph.script).toContain("[composed]ass=filename=keyboard-overlays.subtitle");
  });

  it("computes geometry for square output and configurable padding", () => {
    expect(
      productDemoGeometry(input.recording.viewport, {
        ...input.config,
        width: 1080,
        height: 1080,
        padding: 72,
        paddingMode: "minimum",
      }),
    ).toEqual({
      content: { x: 72, y: 272, width: 936, height: 586 },
      browser: { x: 72, y: 224, width: 936, height: 634 },
    });
  });

  it("uses exact four-sided padding for a matched capture viewport", () => {
    expect(
      productDemoGeometry(
        { width: 1252, height: 900 },
        { ...input.config, width: 1920, height: 1440, padding: 20, paddingMode: "exact" },
      ),
    ).toEqual({
      content: { x: 20, y: 68, width: 1880, height: 1352 },
      browser: { x: 20, y: 20, width: 1880, height: 1400 },
    });
    expect(() =>
      productDemoGeometry(input.recording.viewport, {
        ...input.config,
        width: 1920,
        height: 1440,
        padding: 20,
        paddingMode: "exact",
      }),
    ).toThrow("requires a capture viewport ratio");
  });

  it("builds fixed-canvas keyboard HUD labels and intervals", () => {
    expect(keyDisplayLabel("Meta")).toBe("⌘");
    expect(keyDisplayLabel("Escape")).toBe("esc");
    const keyEvent = { type: "key-press" as const, timestampMs: 1200, keys: ["Meta", "K"] };
    expect(keyOverlayIntervals([keyEvent], 250, 1750)).toEqual([
      { event: keyEvent, startMs: 1200, endMs: 1750 },
    ]);
    const script = generateKeyboardOverlayScript({
      composition: {
        recording: input.recording,
        timeline: input.timeline,
        config: input.config,
      },
      frameCount: 45,
    });
    expect(script).toContain("⌘");
    expect(script).toContain("KeyboardLabel");
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
    expect(overlayScript).toContain("example.com/a｛b｝");
    expect(overlayScript).not.toContain("https://example.com/a{b}");
  });
});
