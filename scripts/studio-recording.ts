import { spawn } from "node:child_process";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareRecording } from "../apps/cli/src/renderer/index.js";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const [recordingArgument, ...studioArguments] = process.argv.slice(2);
if (!recordingArgument) {
  throw new Error("Usage: pnpm studio:recording <recording-id-or-path> [Remotion Studio options]");
}

const recordingPath = isAbsolute(recordingArgument)
  ? recordingArgument
  : recordingArgument.includes("/") || recordingArgument.startsWith(".")
    ? resolve(repositoryRoot, recordingArgument)
    : join(repositoryRoot, "recordings", recordingArgument);
const prepared = await prepareRecording(recordingPath);
const safeId = prepared.manifest.id.replaceAll(/[^A-Za-z0-9._-]/g, "-");
const assetDirectory = join(repositoryRoot, "apps/remotion/public/generated", safeId);
const videoFilename = "browser.webm";
const propsPath = join(assetDirectory, "props.json");

await mkdir(assetDirectory, { recursive: true });
await cp(prepared.videoPath, join(assetDirectory, videoFilename));
await writeFile(
  propsPath,
  `${JSON.stringify(
    {
      ...prepared.input,
      videoUrl: `/generated/${safeId}/${videoFilename}`,
    },
    null,
    2,
  )}\n`,
);

console.log(`[demo-recorder] Studio recording prepared: ${propsPath}`);
const child = spawn(
  "pnpm",
  [
    "--filter",
    "@noice-tech/demo-recorder-remotion",
    "studio",
    `--props=${propsPath}`,
    ...studioArguments,
  ],
  { cwd: repositoryRoot, stdio: "inherit" },
);

const exitCode = await new Promise<number>((resolveExit, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (signal) reject(new Error(`Remotion Studio exited from signal ${signal}`));
    else resolveExit(code ?? 1);
  });
});
if (exitCode !== 0) process.exitCode = exitCode;
