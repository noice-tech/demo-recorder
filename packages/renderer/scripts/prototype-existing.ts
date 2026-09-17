import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  buildTimeline,
  canvasToOptions,
  parsePresentation,
  parseRecording,
  resolveRenderConfig,
} from "@noice-tech/demo-recorder-core";
import { renderProductDemo, runProcess } from "../src/index.js";

const recordingArgument = process.argv[2];
if (!recordingArgument) {
  throw new Error("Usage: pnpm prototype <recording-directory> [output.mp4]");
}
const recordingDirectory = resolve(recordingArgument);
const recording = parseRecording(
  JSON.parse(await readFile(join(recordingDirectory, "recording.json"), "utf8")) as unknown,
);
const presentation = await readFile(join(recordingDirectory, "presentation.json"), "utf8")
  .then((value) => parsePresentation(JSON.parse(value) as unknown))
  .catch(() => undefined);
const timeline = buildTimeline(presentation, recording);
const config = resolveRenderConfig({
  viewport: recording.viewport,
  canvas: canvasToOptions(presentation?.canvas),
  ...(presentation?.browserFrame ? { browserFrameTheme: presentation.browserFrame.theme } : {}),
});
const outputPath = resolve(
  process.argv[3] ??
    join(process.cwd(), "tmp/ffmpeg-prototype", `${basename(recordingDirectory)}.mp4`),
);
let lastPercent = -10;
const started = performance.now();
const result = await renderProductDemo(
  {
    sourcePath: join(recordingDirectory, recording.video.path),
    recording,
    timeline,
    config,
  },
  {
    outputPath,
    log: (message) => console.log(`[prototype] ${message}`),
    onProgress: (progress) => {
      const percent = Math.floor((progress * 100) / 10) * 10;
      if (percent >= lastPercent + 10 || percent === 100) {
        lastPercent = percent;
        console.log(`[prototype] ${percent}%`);
      }
    },
  },
);
const elapsedSeconds = (performance.now() - started) / 1000;
console.log(
  JSON.stringify(
    {
      ...result,
      elapsedSeconds: Number(elapsedSeconds.toFixed(2)),
      realtimeFactor: Number((elapsedSeconds / (result.durationMs / 1000)).toFixed(2)),
      zoomSegments: timeline.zoomSegments.length,
    },
    null,
    2,
  ),
);

const sheetPath = join(dirname(outputPath), `${basename(outputPath, ".mp4")}.contact-sheet.png`);
await runProcess("ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-i",
  outputPath,
  "-vf",
  "fps=1/4,scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2,tile=4x3:padding=4:margin=4",
  "-frames:v",
  "1",
  "-y",
  sheetPath,
]);
console.log(`[prototype] Contact sheet: ${sheetPath}`);
