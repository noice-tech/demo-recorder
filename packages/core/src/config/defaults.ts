import type { DemoVideoConfig } from "./types.js";
import { resolveBackground } from "./background.js";

export const defaultConfig: DemoVideoConfig = {
  recording: { viewport: { width: 1440, height: 900 } },
  render: {
    width: 1920,
    height: 1080,
    fps: 60,
    padding: 97.2,
    paddingMode: "minimum",
    background: resolveBackground(),
  },
  cursor: { enabled: true },
  zoom: {
    enabled: true,
    clickClusterRadiusPx: 260,
    clickClusterWindowMs: 2200,
    zoomScale: 1.35,
    enterDurationMs: 350,
    exitDurationMs: 450,
    paddingBeforeMs: 300,
    paddingAfterMs: 900,
  },
};
