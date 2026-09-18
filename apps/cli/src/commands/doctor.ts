import { existsSync } from "node:fs";
import { inspectFfmpegCapabilities } from "@noice-tech/demo-recorder-renderer";
import { chromium } from "playwright";
import { findFfmpeg, findFfprobe, findFfmpegAssets } from "../support/ffmpeg.js";

export type DoctorCheck = { name: string; ok: boolean; detail: string };

function chromiumPath(): { path: string; location: string } {
  try {
    const path = chromium.executablePath();
    return { path, location: existsSync(path) ? path : "not downloaded" };
  } catch (error) {
    return { path: "", location: error instanceof Error ? error.message : String(error) };
  }
}

export async function runDoctor(): Promise<unknown> {
  const checks: DoctorCheck[] = [];

  const nodeMajor = Number(process.versions.node.split(".")[0] ?? 0);
  checks.push({ name: "node", ok: nodeMajor >= 22, detail: process.version });

  const chromiumExecutable = chromiumPath();
  checks.push({
    name: "chromium",
    ok: existsSync(chromiumExecutable.path),
    detail: chromiumExecutable.location,
  });

  const assets = findFfmpegAssets();
  checks.push({ name: "ffmpeg-assets", ok: Boolean(assets), detail: assets ?? "not found" });

  const ffmpeg = await inspectFfmpegCapabilities({
    ffmpegPath: findFfmpeg(),
    ffprobePath: findFfprobe(),
  }).catch(() => undefined);
  checks.push({
    name: "ffmpeg",
    ok: Boolean(ffmpeg?.ffmpegVersion),
    detail: ffmpeg?.ffmpegVersion ?? ffmpeg?.errors.join("; ") ?? "unavailable",
  });
  checks.push({
    name: "ffprobe",
    ok: Boolean(ffmpeg?.ffprobeVersion),
    detail: ffmpeg?.ffprobeVersion ?? "unavailable",
  });
  checks.push({
    name: "renderer",
    ok: Boolean(ffmpeg?.ready),
    detail: ffmpeg?.ready
      ? `h264: ${ffmpeg.h264Encoders.join(", ")}`
      : (ffmpeg?.errors.join("; ") ?? "unavailable"),
  });

  const ready = checks.every((check) => check.ok);
  return {
    status: ready ? "ready" : "needs-attention",
    ready,
    checks,
    ffmpeg: ffmpeg
      ? {
          path: ffmpeg.ffmpegPath,
          ffprobePath: ffmpeg.ffprobePath,
          version: ffmpeg.ffmpegVersion,
          missingFilters: ffmpeg.missingFilters,
          h264Encoders: ffmpeg.h264Encoders,
          errors: ffmpeg.errors,
        }
      : undefined,
  };
}
