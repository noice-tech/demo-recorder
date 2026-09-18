// Render a PNG through the production filter graph, including fonts, shadow,
// corner mask, browser chrome, and cursor. No browser capture or video output.
// pnpm exec tsx scripts/preview-browser-frame.ts SOURCE.png [OUTPUT_DIRECTORY]
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBackground } from "../packages/core/src/index.js";
import { buildProductDemoFilterGraph } from "../packages/renderer/src/graph.js";
import { generateBackgroundRaster, productDemoGeometry } from "../packages/renderer/src/frames.js";
import {
  generateKeyboardOverlayScript,
  generateTimedOverlayScript,
} from "../packages/renderer/src/overlays.js";
import type { ProductDemoRenderInput } from "../packages/renderer/src/ffmpeg.js";

if (!process.argv[2])
  throw new Error("Usage: preview-browser-frame.ts SOURCE.png [OUTPUT_DIRECTORY]");
const sourcePath = resolve(process.argv[2]);
const directory = resolve(process.argv[3] ?? "output/browser-frame-preview");
const assets = fileURLToPath(new URL("../packages/renderer/assets/", import.meta.url));
const probe = JSON.parse(
  execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      sourcePath,
    ],
    { encoding: "utf8" },
  ),
) as { streams: { width: number; height: number }[] };
const viewport = probe.streams[0]!;
mkdirSync(join(directory, "fonts"), { recursive: true });
copyFileSync(join(assets, "fonts/Inter-Variable.ttf"), join(directory, "fonts/Inter-Variable.ttf"));
for (const theme of ["light", "dark"] as const) {
  const input: ProductDemoRenderInput = {
    sourcePath,
    recording: {
      version: 1,
      id: "frame-preview",
      createdAt: "2026-01-01T00:00:00Z",
      durationMs: 1000,
      viewport,
      guarded: true,
      cursor: "synthetic",
      video: { path: sourcePath, ...viewport },
      events: [
        { type: "navigation", timestampMs: 0, url: "https://www.apple.com/shop/buy-iphone" },
        {
          type: "cursor-move",
          timestampMs: 0,
          x: viewport.width * 0.75,
          y: viewport.height * (787 / 900),
        },
      ],
    },
    timeline: { trimStartMs: 0, trimEndMs: 1000, zoomSegments: [] },
    config: {
      width: 1600,
      height: 1080,
      fps: 30,
      padding: 110,
      paddingMode: "minimum",
      background: resolveBackground({
        type: "gradient",
        angle: 145,
        colors: ["#E9E5F1", "#CDD9E8"],
      }),
      browserFrameTheme: theme,
      cursorEnabled: true,
      zoom: { enterDurationMs: 350, exitDurationMs: 450 },
    },
  };
  const graph = buildProductDemoFilterGraph(input);
  const composition = {
    recording: input.recording,
    timeline: input.timeline,
    config: input.config,
  };
  writeFileSync(join(directory, "filter.txt"), graph.script);
  writeFileSync(
    join(directory, "timed-overlays.subtitle"),
    generateTimedOverlayScript({
      composition,
      geometry: productDemoGeometry(viewport, input.config),
      frameCount: graph.frameCount,
    }),
  );
  writeFileSync(
    join(directory, "keyboard-overlays.subtitle"),
    generateKeyboardOverlayScript({ composition, frameCount: graph.frameCount }),
  );
  writeFileSync(
    join(directory, "background.ppm"),
    generateBackgroundRaster(input.config.width, input.config.height, input.config.background),
  );
  execFileSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-loop",
      "1",
      "-framerate",
      "30",
      "-i",
      sourcePath,
      "-i",
      join(assets, "browser-underlay.png"),
      "-i",
      join(assets, "content-mask.png"),
      "-i",
      join(assets, "browser-overlay.png"),
      "-i",
      "background.ppm",
      "-filter_complex_script",
      "filter.txt",
      "-map",
      "[output]",
      "-frames:v",
      "1",
      `${theme}.png`,
    ],
    { cwd: directory, stdio: "inherit" },
  );
  console.log(join(directory, `${theme}.png`));
}
