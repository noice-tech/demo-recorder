import { spawn } from "node:child_process";
import {
  cp,
  link,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DemoTimeline, Recording, RenderConfig } from "@noice-tech/demo-recorder-core";
import { z } from "zod";
import { generateBackgroundRaster, productDemoGeometry } from "./frames.js";
import { buildProductDemoFilterGraph } from "./graph.js";
import { generateKeyboardOverlayScript, generateTimedOverlayScript } from "./overlays.js";

// ---------------------------------------------------------------------------
// Public render types
// ---------------------------------------------------------------------------

export type ProductDemoRenderInput = {
  sourcePath: string;
  recording: Recording;
  timeline: DemoTimeline;
  config: RenderConfig;
};

export type RenderProductDemoOptions = {
  outputPath: string;
  assetsDirectory?: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  overwrite?: boolean;
  signal?: AbortSignal;
  log?: (message: string) => void;
  onProgress?: (progress: number) => void;
};

export type RenderProductDemoResult = {
  outputPath: string;
  frameCount: number;
  durationMs: number;
};

// ---------------------------------------------------------------------------
// Process spawning
// ---------------------------------------------------------------------------

export type RunProcessOptions = {
  cwd?: string;
  signal?: AbortSignal;
  stdin?: "ignore" | "inherit";
  onStdout?: (chunk: Buffer) => void;
  onStderr?: (chunk: Buffer) => void;
  onProgress?: (chunk: Buffer) => void;
};

export type ProcessResult = {
  stdout: string;
  stderr: string;
};

export async function runProcess(
  executable: string,
  arguments_: readonly string[],
  options: RunProcessOptions = {},
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...arguments_], {
      cwd: options.cwd,
      signal: options.signal,
      windowsHide: true,
      stdio: [options.stdin ?? "ignore", "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
    };
    child.stdout!.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      options.onStdout?.(chunk);
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 100_000) stderr = stderr.slice(-100_000);
      options.onStderr?.(chunk);
    });
    child.stdio[3]?.on("data", (chunk: Buffer) => options.onProgress?.(chunk));
    let processError: Error | undefined;
    child.once("error", (error) => {
      processError = error;
    });
    child.once("close", (code, signal) => {
      finish(() => {
        if (processError) {
          reject(processError);
        } else if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          const reason = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
          reject(new Error(`${executable} failed with ${reason}: ${stderr.slice(-4_000).trim()}`));
        }
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Probing
// ---------------------------------------------------------------------------

const streamSchema = z.object({
  codec_type: z.string().optional(),
  codec_name: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  avg_frame_rate: z.string().optional(),
  r_frame_rate: z.string().optional(),
  duration: z.string().optional(),
  pix_fmt: z.string().optional(),
  sample_rate: z.string().optional(),
  channels: z.number().int().positive().optional(),
});

const probeSchema = z.object({
  streams: z.array(streamSchema).default([]),
  format: z
    .object({ duration: z.string().optional(), format_name: z.string().optional() })
    .passthrough()
    .optional(),
});

export type ProbedVideo = {
  width: number;
  height: number;
  durationMs: number;
  fps?: number;
  codec?: string;
  pixelFormat?: string;
  container?: string;
  hasAudio: boolean;
};

function parseRate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const [numeratorText, denominatorText = "1"] = value.split("/");
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText);
  const rate = numerator / denominator;
  return Number.isFinite(rate) && rate > 0 ? rate : undefined;
}

export function parseFfprobeOutput(input: unknown, path = "media"): ProbedVideo {
  const parsed = probeSchema.parse(input);
  const video = parsed.streams.find((stream) => stream.codec_type === "video");
  if (!video?.width || !video.height) throw new Error(`ffprobe found no video stream in ${path}`);
  const durationSeconds = Number(video.duration ?? parsed.format?.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(`ffprobe returned no positive duration for ${path}`);
  }
  const fps = parseRate(video.avg_frame_rate ?? video.r_frame_rate);
  return {
    width: video.width,
    height: video.height,
    durationMs: durationSeconds * 1000,
    ...(fps ? { fps } : {}),
    ...(video.codec_name ? { codec: video.codec_name } : {}),
    ...(video.pix_fmt ? { pixelFormat: video.pix_fmt } : {}),
    ...(parsed.format?.format_name ? { container: parsed.format.format_name } : {}),
    hasAudio: parsed.streams.some((stream) => stream.codec_type === "audio"),
  };
}

export async function probeVideo(
  path: string,
  options: { ffprobePath?: string; signal?: AbortSignal } = {},
): Promise<ProbedVideo> {
  const ffprobePath = options.ffprobePath ?? process.env.DEMO_RECORDER_FFPROBE ?? "ffprobe";
  const processOptions = options.signal ? { signal: options.signal } : {};
  const result = await runProcess(
    ffprobePath,
    ["-v", "error", "-show_streams", "-show_format", "-of", "json", path],
    processOptions,
  );
  return parseFfprobeOutput(JSON.parse(result.stdout) as unknown, path);
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

const REQUIRED_FILTERS = [
  "alphaextract",
  "alphamerge",
  "ass",
  "color",
  "colorspace",
  "format",
  "fps",
  "geq",
  "gblur",
  "overlay",
  "scale",
  "setpts",
  "setsar",
  "trim",
] as const;

const H264_ENCODERS = [
  "libx264",
  "h264_videotoolbox",
  "h264_nvenc",
  "h264_qsv",
  "h264_vaapi",
] as const;

export type FfmpegCapabilities = {
  ffmpegPath: string;
  ffprobePath: string;
  ffmpegVersion?: string;
  ffprobeVersion?: string;
  filters: string[];
  missingFilters: string[];
  h264Encoders: string[];
  ready: boolean;
  errors: string[];
};

function firstVersionLine(output: string): string | undefined {
  const value = output.split(/\r?\n/, 1)[0]?.trim();
  return value || undefined;
}

export function parseFfmpegFilters(output: string): Set<string> {
  const result = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*[TSC.]{3}\s+(\S+)\s/.exec(line);
    if (match?.[1] && match[1] !== "=") result.add(match[1]);
  }
  return result;
}

export function parseFfmpegEncoders(output: string): Set<string> {
  const result = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*[VAS.][FSXBD.]{5}\s+(\S+)\s/.exec(line);
    if (match?.[1] && match[1] !== "=") result.add(match[1]);
  }
  return result;
}

export async function inspectFfmpegCapabilities(
  options: {
    ffmpegPath?: string;
    ffprobePath?: string;
  } = {},
): Promise<FfmpegCapabilities> {
  const ffmpegPath = options.ffmpegPath ?? process.env.DEMO_RECORDER_FFMPEG ?? "ffmpeg";
  const ffprobePath = options.ffprobePath ?? process.env.DEMO_RECORDER_FFPROBE ?? "ffprobe";
  const errors: string[] = [];
  const ffmpegVersionResult = await runProcess(ffmpegPath, ["-version"]).catch((error: unknown) => {
    errors.push(`FFmpeg unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  });
  const ffprobeVersionResult = await runProcess(ffprobePath, ["-version"]).catch(
    (error: unknown) => {
      errors.push(`ffprobe unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    },
  );
  const filtersResult = ffmpegVersionResult
    ? await runProcess(ffmpegPath, ["-hide_banner", "-filters"]).catch((error: unknown) => {
        errors.push(`Unable to inspect FFmpeg filters: ${String(error)}`);
        return undefined;
      })
    : undefined;
  const encodersResult = ffmpegVersionResult
    ? await runProcess(ffmpegPath, ["-hide_banner", "-encoders"]).catch((error: unknown) => {
        errors.push(`Unable to inspect FFmpeg encoders: ${String(error)}`);
        return undefined;
      })
    : undefined;
  const filters = parseFfmpegFilters(filtersResult?.stdout ?? "");
  const encoders = parseFfmpegEncoders(encodersResult?.stdout ?? "");
  const ffmpegVersion = firstVersionLine(ffmpegVersionResult?.stdout ?? "");
  const ffprobeVersion = firstVersionLine(ffprobeVersionResult?.stdout ?? "");
  const missingFilters = REQUIRED_FILTERS.filter((name) => !filters.has(name));
  const h264Encoders = H264_ENCODERS.filter((name) => encoders.has(name));
  if (missingFilters.length > 0)
    errors.push(`Missing FFmpeg filters: ${missingFilters.join(", ")}`);
  if (h264Encoders.length === 0) errors.push("No supported H.264 encoder found");
  return {
    ffmpegPath,
    ffprobePath,
    ...(ffmpegVersion ? { ffmpegVersion } : {}),
    ...(ffprobeVersion ? { ffprobeVersion } : {}),
    filters: [...filters],
    missingFilters,
    h264Encoders,
    ready:
      Boolean(ffmpegVersionResult) &&
      Boolean(ffprobeVersionResult) &&
      missingFilters.length === 0 &&
      h264Encoders.length > 0,
    errors,
  };
}

export const ffmpegCapabilityRequirements = {
  filters: REQUIRED_FILTERS,
  h264Encoders: H264_ENCODERS,
};

// ---------------------------------------------------------------------------
// Progress parsing
// ---------------------------------------------------------------------------

export type FfmpegProgress = {
  outTimeMs: number;
  progress?: string;
};

export function createProgressParser(onProgress: (value: FfmpegProgress) => void) {
  let buffered = "";
  let current: FfmpegProgress = { outTimeMs: 0 };
  return (chunk: string | Buffer): void => {
    buffered += chunk.toString();
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      const separator = line.indexOf("=");
      if (separator < 0) continue;
      const key = line.slice(0, separator);
      const value = line.slice(separator + 1);
      if (key === "out_time_us" || key === "out_time_ms") {
        const microseconds = Number(value);
        if (Number.isFinite(microseconds)) current.outTimeMs = microseconds / 1000;
      }
      if (key === "progress") {
        current.progress = value;
        onProgress(current);
        current = { outTimeMs: current.outTimeMs };
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Render orchestration
// ---------------------------------------------------------------------------

const DEFAULT_ASSETS = fileURLToPath(new URL("../assets/", import.meta.url));
const ASSET_FILES = ["browser-underlay.png", "content-mask.png", "browser-overlay.png"] as const;
const FONT_FILE = "fonts/Inter-Variable.ttf";

async function requireFile(path: string): Promise<void> {
  const value = await stat(path).catch(() => undefined);
  if (!value?.isFile()) throw new Error(`FFmpeg renderer asset is missing: ${path}`);
}

export async function renderProductDemo(
  input: ProductDemoRenderInput,
  options: RenderProductDemoOptions,
): Promise<RenderProductDemoResult> {
  const outputPath = resolve(options.outputPath);
  const [sourceIdentity, outputIdentity] = await Promise.all([
    realpath(input.sourcePath).catch(() => resolve(input.sourcePath)),
    realpath(outputPath).catch(() => outputPath),
  ]);
  if (outputIdentity === sourceIdentity)
    throw new Error("Render output must differ from the source recording");
  if (options.overwrite === false) {
    const existing = await lstat(outputPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return undefined;
    });
    if (existing) throw new Error(`Render output already exists: ${outputPath}`);
  }
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
  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "demo-recorder-renderer-"));
  let pendingDirectory: string | undefined;
  try {
    // Same filesystem as the destination: publication is atomic, and cleanup never owns it.
    pendingDirectory = await mkdtemp(join(dirname(outputPath), ".demo-recorder-render-"));
    const pendingOutput = join(pendingDirectory, "video.mp4");
    const graph = buildProductDemoFilterGraph(input);
    const geometry = productDemoGeometry(input.recording.viewport, input.config);
    const composition = {
      recording: input.recording,
      timeline: input.timeline,
      config: input.config,
    };
    const overlayScript = generateTimedOverlayScript({
      composition,
      geometry,
      frameCount: graph.frameCount,
    });
    const keyboardOverlayScript = generateKeyboardOverlayScript({
      composition,
      frameCount: graph.frameCount,
    });
    await mkdir(join(temporaryDirectory, "fonts"));
    const backgroundPath = join(temporaryDirectory, "background.ppm");
    await Promise.all([
      writeFile(join(temporaryDirectory, "filter.txt"), graph.script),
      writeFile(join(temporaryDirectory, "timed-overlays.subtitle"), overlayScript),
      writeFile(join(temporaryDirectory, "keyboard-overlays.subtitle"), keyboardOverlayScript),
      writeFile(
        backgroundPath,
        generateBackgroundRaster(input.config.width, input.config.height, input.config.background),
      ),
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
        backgroundPath,
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
        "-n",
        pendingOutput,
      ],
      {
        cwd: temporaryDirectory,
        ...(options.signal ? { signal: options.signal } : {}),
        onProgress: parseProgress,
      },
    );
    if (options.signal?.aborted) throw new Error("Rendering cancelled");
    if ((await stat(pendingOutput)).size === 0) throw new Error("Rendered video is empty");
    if (options.overwrite === false) await link(pendingOutput, outputPath);
    else await rename(pendingOutput, outputPath);
    reportProgress(1);
    return { outputPath, frameCount: graph.frameCount, durationMs: graph.durationMs };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
    if (pendingDirectory)
      await rm(pendingDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}
