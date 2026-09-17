import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
export const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const rendererAssetFiles = [
  "browser-underlay.png",
  "browser-overlay.png",
  "content-mask.png",
  "fonts/Inter-Variable.ttf",
  "fonts/OFL.txt",
] as const;

function isRendererAssetsDirectory(path: string): boolean {
  return rendererAssetFiles.every((name) => existsSync(join(path, name)));
}

export function findFfmpegAssets(): string | undefined {
  return [
    ...(process.env.DEMO_RECORDER_FFMPEG_ASSETS ? [process.env.DEMO_RECORDER_FFMPEG_ASSETS] : []),
    // Bundled dist/cli.js and source src/support/ffmpeg.ts have different depths.
    fileURLToPath(new URL("../assets/ffmpeg", import.meta.url)),
    join(packageRoot, "assets/ffmpeg"),
    join(repositoryRoot, "packages/renderer/assets"),
  ].find(isRendererAssetsDirectory);
}

export function requireFfmpegAssets(): string {
  const path = findFfmpegAssets();
  if (path) return path;
  throw new Error(
    "FFmpeg renderer assets are missing. Run `pnpm package:cli` in a source checkout or reinstall Demo Recorder.",
  );
}

export function findFfmpeg(): string {
  return process.env.DEMO_RECORDER_FFMPEG ?? "ffmpeg";
}

export function findFfprobe(): string {
  return process.env.DEMO_RECORDER_FFPROBE ?? "ffprobe";
}
