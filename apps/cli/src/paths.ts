import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const packageRoot = fileURLToPath(new URL("..", import.meta.url));
export const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
export const workingDirectory =
  process.env.DEMO_RECORDER_CWD ?? process.env.INIT_CWD ?? process.cwd();

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
    join(packageRoot, "assets/ffmpeg"),
    join(repositoryRoot, "packages/ffmpeg-renderer/assets"),
  ].find(isRendererAssetsDirectory);
}

export function requireFfmpegAssets(): string {
  const path = findFfmpegAssets();
  if (path) return path;
  throw new Error(
    "FFmpeg renderer assets are missing. Run `pnpm package:cli` in a source checkout or reinstall Demo Recorder.",
  );
}
