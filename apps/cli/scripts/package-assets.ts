import { cp, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cliRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const assetsRoot = join(cliRoot, "assets");
const rendererSource = join(repositoryRoot, "packages/ffmpeg-renderer/assets");
const rendererTarget = join(assetsRoot, "ffmpeg");
const rendererAssets = [
  "background.png",
  "browser-underlay.png",
  "browser-overlay.png",
  "content-mask.png",
] as const;

async function requireFile(path: string): Promise<void> {
  const value = await stat(path).catch(() => undefined);
  if (!value?.isFile()) throw new Error(`FFmpeg renderer asset is missing: ${path}`);
}

await Promise.all(rendererAssets.map((name) => requireFile(join(rendererSource, name))));
await rm(assetsRoot, { recursive: true, force: true });
await mkdir(rendererTarget, { recursive: true });
await Promise.all(
  rendererAssets.map((name) => cp(join(rendererSource, name), join(rendererTarget, name))),
);

console.log(`[demo-recorder] FFmpeg renderer assets prepared: ${rendererTarget}`);
