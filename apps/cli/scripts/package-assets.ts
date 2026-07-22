import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cliRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const assetsRoot = join(cliRoot, "assets");
const remotionSource = join(repositoryRoot, "apps/remotion/build");

async function requireDirectory(path: string, label: string): Promise<void> {
  const value = await stat(path).catch(() => undefined);
  if (!value?.isDirectory()) throw new Error(`${label} is missing: ${path}`);
}

await requireDirectory(remotionSource, "Remotion build");
await rm(assetsRoot, { recursive: true, force: true });
await mkdir(dirname(assetsRoot), { recursive: true });
const remotionTarget = join(assetsRoot, "remotion");
await cp(remotionSource, remotionTarget, { recursive: true });

// Studio-only media is local, ignored, and may contain private recordings. The
// published composition receives its video URL dynamically from the renderer.
await rm(join(remotionTarget, "public"), { recursive: true, force: true });

// Remotion embeds the build machine's absolute cwd in index.html. It is not
// needed by the packaged renderer and must not leak into the npm tarball.
const indexPath = join(remotionTarget, "index.html");
const index = await readFile(indexPath, "utf8");
const sanitizedIndex = index.replace(/window\.remotion_cwd = .*?;/, 'window.remotion_cwd = "";');
if (sanitizedIndex === index) throw new Error("Remotion index does not contain an expected cwd");
await writeFile(indexPath, sanitizedIndex);

console.log(`[demo-recorder] Package assets prepared: ${assetsRoot}`);
