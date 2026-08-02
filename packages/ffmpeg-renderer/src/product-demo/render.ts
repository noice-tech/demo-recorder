import { cp, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectFfmpegCapabilities } from "../capabilities.js";
import { probeVideo } from "../ffprobe.js";
import { createProgressParser } from "../progress.js";
import { runProcess } from "../process.js";
import type {
  ProductDemoRenderInput,
  RenderProductDemoOptions,
  RenderProductDemoResult,
} from "../types.js";
import { generateTimedOverlayScript } from "./overlay-script.js";
import { buildProductDemoFilterGraph } from "./filter-graph.js";
import { productDemoGeometry } from "./geometry.js";

const DEFAULT_ASSETS = fileURLToPath(new URL("../../assets/", import.meta.url));
const ASSET_FILES = [
  "browser-underlay.png",
  "content-mask.png",
  "browser-overlay.png",
  "background.png",
] as const;
const FONT_FILE = "fonts/Inter-Variable.ttf";

async function requireFile(path: string): Promise<void> {
  const value = await stat(path).catch(() => undefined);
  if (!value?.isFile()) throw new Error(`FFmpeg renderer asset is missing: ${path}`);
}

export async function renderProductDemo(
  input: ProductDemoRenderInput,
  options: RenderProductDemoOptions,
): Promise<RenderProductDemoResult> {
  const ffmpegPath = options.ffmpegPath ?? process.env.DEMO_RECORDER_FFMPEG ?? "ffmpeg";
  const ffprobePath = options.ffprobePath ?? process.env.DEMO_RECORDER_FFPROBE ?? "ffprobe";
  const capabilities = await inspectFfmpegCapabilities({ ffmpegPath, ffprobePath });
  if (!capabilities.ready) throw new Error(capabilities.errors.join("; "));
  if (!capabilities.h264Encoders.includes("libx264")) {
    throw new Error("The initial FFmpeg renderer requires the libx264 encoder");
  }

  const source = await probeVideo(input.sourcePath, {
    ffprobePath,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (
    source.width !== input.recording.video.width ||
    source.height !== input.recording.video.height
  ) {
    throw new Error(
      `Source dimensions ${source.width}x${source.height} do not match recording manifest ${input.recording.video.width}x${input.recording.video.height}`,
    );
  }
  if (Math.abs(source.durationMs - input.recording.durationMs) > 100) {
    throw new Error(
      `Source duration ${source.durationMs}ms does not match recording manifest ${input.recording.durationMs}ms`,
    );
  }

  const assetsDirectory = resolve(options.assetsDirectory ?? DEFAULT_ASSETS);
  const assetPaths = ASSET_FILES.map((name) => join(assetsDirectory, name));
  const fontPath = join(assetsDirectory, FONT_FILE);
  await Promise.all([...assetPaths.map(requireFile), requireFile(fontPath)]);
  const outputPath = resolve(options.outputPath);
  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "demo-recorder-ffmpeg-"));
  let completed = false;
  try {
    const graph = buildProductDemoFilterGraph(input);
    const geometry = productDemoGeometry(input.recording.viewport, input.config);
    const overlayScript = generateTimedOverlayScript({
      composition: {
        recording: input.recording,
        timeline: input.timeline,
        config: input.config,
      },
      geometry,
      frameCount: graph.frameCount,
    });
    await mkdir(join(temporaryDirectory, "fonts"));
    await Promise.all([
      writeFile(join(temporaryDirectory, "filter.txt"), graph.script),
      writeFile(join(temporaryDirectory, "timed-overlays.subtitle"), overlayScript),
      cp(fontPath, join(temporaryDirectory, FONT_FILE)),
    ]);

    let lastProgress = -1;
    const reportProgress = (value: number) => {
      if (value <= lastProgress) return;
      lastProgress = value;
      options.onProgress?.(value);
    };
    const parseProgress = createProgressParser(({ outTimeMs }) => {
      reportProgress(Math.min(0.99, outTimeMs / graph.durationMs));
    });
    options.log?.(`Rendering ${graph.frameCount} frames with FFmpeg/libx264`);
    await runProcess(
      ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        resolve(input.sourcePath),
        "-i",
        assetPaths[0] ?? "",
        "-i",
        assetPaths[1] ?? "",
        "-i",
        assetPaths[2] ?? "",
        "-i",
        assetPaths[3] ?? "",
        "-filter_complex_script",
        "filter.txt",
        "-map",
        "[output]",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-crf",
        "16",
        "-bf",
        "0",
        "-pix_fmt",
        "yuv420p",
        "-r",
        input.config.fps.toString(),
        "-fps_mode",
        "cfr",
        "-movflags",
        "+faststart",
        "-progress",
        "pipe:3",
        "-nostats",
        options.overwrite === false ? "-n" : "-y",
        outputPath,
      ],
      {
        cwd: temporaryDirectory,
        ...(options.signal ? { signal: options.signal } : {}),
        onProgress: parseProgress,
      },
    );
    completed = true;
    reportProgress(1);
    return { outputPath, frameCount: graph.frameCount, durationMs: graph.durationMs };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
    if (!completed) await rm(outputPath, { force: true }).catch(() => undefined);
  }
}
