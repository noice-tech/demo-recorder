import { spawn } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { inspectFfmpegCapabilities } from "@noice-tech/demo-recorder-ffmpeg";
import { chromium } from "playwright";
import type { ParsedArguments } from "./arguments.js";
import { findFfmpegAssets, workingDirectory } from "./paths.js";
import { cliVersion } from "./version.js";

type DoctorStatus = "ready" | "needs-setup" | "unsupported";
type CapabilityStatus = "ready" | "missing" | "unsupported";

export type DoctorResult = {
  status: DoctorStatus;
  cliVersion: string;
  node: { version: string; supported: boolean };
  workspace: string;
  writable: boolean;
  paths: { state: string; recordings: string; output: string };
  capabilities: {
    playwrightChromium: CapabilityStatus;
    rendererAssets: CapabilityStatus;
    ffmpeg: CapabilityStatus;
    ffprobe: CapabilityStatus;
    ffmpegFilters: CapabilityStatus;
    h264Encoder: string | "missing";
    contactSheet: CapabilityStatus;
  };
  ffmpeg: {
    version?: string;
    ffprobeVersion?: string;
    missingFilters: string[];
    errors: string[];
  };
};

function chromiumAvailable(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

export async function inspectEnvironment(): Promise<DoctorResult> {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const nodeSupported = Number.isSafeInteger(nodeMajor) && nodeMajor >= 22;
  const writable = await access(workingDirectory, constants.W_OK)
    .then(() => true)
    .catch(() => false);
  const hasChromium = chromiumAvailable();
  const hasRendererAssets = Boolean(findFfmpegAssets());
  const ffmpeg = await inspectFfmpegCapabilities();
  const hasFfmpeg = Boolean(ffmpeg.ffmpegVersion);
  const hasFfprobe = Boolean(ffmpeg.ffprobeVersion);
  const filtersReady = hasFfmpeg && ffmpeg.missingFilters.length === 0;
  const h264Encoder = ffmpeg.h264Encoders.includes("libx264")
    ? "libx264"
    : (ffmpeg.h264Encoders[0] ?? "missing");
  const libx264Ready = h264Encoder === "libx264";
  const renderReady = hasRendererAssets && hasFfmpeg && hasFfprobe && filtersReady && libx264Ready;
  const rendererErrors = [
    ...ffmpeg.errors,
    ...(!libx264Ready && h264Encoder !== "missing"
      ? [`Initial renderer requires libx264; detected ${h264Encoder}`]
      : []),
  ];
  const unsupported = !nodeSupported || !writable || !renderReady;
  return {
    status: unsupported ? "unsupported" : hasChromium ? "ready" : "needs-setup",
    cliVersion,
    node: { version: process.versions.node, supported: nodeSupported },
    workspace: workingDirectory,
    writable,
    paths: {
      state: join(workingDirectory, ".demo-recorder"),
      recordings: join(workingDirectory, "recordings"),
      output: join(workingDirectory, "output"),
    },
    capabilities: {
      playwrightChromium: hasChromium ? "ready" : "missing",
      rendererAssets: hasRendererAssets ? "ready" : "missing",
      ffmpeg: hasFfmpeg ? "ready" : "missing",
      ffprobe: hasFfprobe ? "ready" : "missing",
      ffmpegFilters: filtersReady ? "ready" : hasFfmpeg ? "unsupported" : "missing",
      h264Encoder,
      contactSheet: hasFfmpeg ? "ready" : "missing",
    },
    ffmpeg: {
      ...(ffmpeg.ffmpegVersion ? { version: ffmpeg.ffmpegVersion } : {}),
      ...(ffmpeg.ffprobeVersion ? { ffprobeVersion: ffmpeg.ffprobeVersion } : {}),
      missingFilters: ffmpeg.missingFilters,
      errors: rendererErrors,
    },
  };
}

function printDoctor(result: DoctorResult, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`[demo-recorder] Status: ${result.status}`);
  console.log(`[demo-recorder] CLI: ${result.cliVersion}`);
  console.log(
    `[demo-recorder] Node: ${result.node.version} (${result.node.supported ? "supported" : "requires 22+"})`,
  );
  console.log(`[demo-recorder] Workspace: ${result.workspace}`);
  console.log(`[demo-recorder] Playwright Chromium: ${result.capabilities.playwrightChromium}`);
  console.log(`[demo-recorder] FFmpeg renderer assets: ${result.capabilities.rendererAssets}`);
  console.log(`[demo-recorder] FFmpeg: ${result.capabilities.ffmpeg}`);
  console.log(`[demo-recorder] ffprobe: ${result.capabilities.ffprobe}`);
  console.log(`[demo-recorder] FFmpeg filters: ${result.capabilities.ffmpegFilters}`);
  console.log(`[demo-recorder] H.264 encoder: ${result.capabilities.h264Encoder}`);
  console.log(`[demo-recorder] Contact sheet: ${result.capabilities.contactSheet}`);
  if (result.ffmpeg.errors.length > 0) {
    for (const error of result.ffmpeg.errors) console.log(`[demo-recorder] FFmpeg issue: ${error}`);
  }
}

function applyDoctorExitCode(result: DoctorResult): void {
  process.exitCode = result.status === "ready" ? 0 : result.status === "needs-setup" ? 2 : 1;
}

export async function doctorCommand(arguments_: ParsedArguments): Promise<void> {
  const result = await inspectEnvironment();
  printDoctor(result, arguments_.options.has("json"));
  applyDoctorExitCode(result);
}

async function runPlaywrightInstall(json: boolean): Promise<void> {
  const require = createRequire(import.meta.url);
  const program = require.resolve("playwright/lib/program");
  await new Promise<void>((resolvePromise, reject) => {
    let standardError = "";
    const child = spawn(process.execPath, [program, "install", "chromium"], {
      stdio: json ? ["ignore", "ignore", "pipe"] : "inherit",
    });
    if (json) child.stderr?.on("data", (chunk: Buffer) => (standardError += chunk.toString()));
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else
        reject(
          new Error(
            `Playwright Chromium installation failed (${signal ?? `exit ${code ?? "unknown"}`})${standardError ? `: ${standardError.trim()}` : ""}`,
          ),
        );
    });
  });
}

export async function setupCommand(arguments_: ParsedArguments): Promise<void> {
  const json = arguments_.options.has("json");
  if (!chromiumAvailable()) await runPlaywrightInstall(json);
  const browser = await chromium.launch({ headless: true });
  await browser.close();
  const result = await inspectEnvironment();
  printDoctor(result, json);
  applyDoctorExitCode(result);
}
