import { access, copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRecordingManifest } from "@noice-tech/demo-recorder-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { probeVideo, renderProductDemo, runProcess } from "../src/index.js";

const fixtureDirectory = fileURLToPath(new URL("fixtures/basic/", import.meta.url));
const assetsDirectory = fileURLToPath(new URL("../assets/", import.meta.url));
const goldenDirectory = join(fixtureDirectory, "golden");
const goldenFrames = [0, 20, 30, 40] as const;

let temporaryDirectory: string;
let outputPath: string;
let sourcePath: string;
let recording: ReturnType<typeof parseRecordingManifest>;
const actualFrames = new Map<number, string>();

function renderInput() {
  return {
    sourcePath,
    recording,
    timeline: {
      zoomSegments: [{ startMs: 400, endMs: 1500, focusX: 160, focusY: 100, scale: 1.35 }],
    },
    config: {
      width: 1920,
      height: 1080,
      fps: 30,
      cursorEnabled: true,
      zoom: { enterDurationMs: 350, exitDurationMs: 450 },
    },
  };
}

async function extractFrame(videoPath: string, frame: number, path: string): Promise<void> {
  await runProcess(process.env.DEMO_RECORDER_FFMPEG ?? "ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    videoPath,
    "-vf",
    `select=eq(n\\,${frame})`,
    "-fps_mode",
    "vfr",
    "-frames:v",
    "1",
    "-y",
    path,
  ]);
}

async function frameSimilarity(actual: string, expected: string): Promise<number> {
  const result = await runProcess(process.env.DEMO_RECORDER_FFMPEG ?? "ffmpeg", [
    "-hide_banner",
    "-i",
    actual,
    "-i",
    expected,
    "-lavfi",
    "[0:v][1:v]ssim",
    "-f",
    "null",
    "-",
  ]);
  const match = /All:([0-9.]+)/.exec(result.stderr);
  if (!match?.[1]) throw new Error(`Unable to parse SSIM output: ${result.stderr.slice(-2_000)}`);
  return Number(match[1]);
}

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "demo recorder ünicode path "));
  sourcePath = join(temporaryDirectory, "source browser ünicode.webm");
  outputPath = join(temporaryDirectory, "rendered product demo ünicode.mp4");
  await copyFile(join(fixtureDirectory, "browser.webm"), sourcePath);
  recording = parseRecordingManifest(
    JSON.parse(await readFile(join(fixtureDirectory, "recording.json"), "utf8")) as unknown,
  );
  await renderProductDemo(renderInput(), { outputPath, assetsDirectory });
  for (const frame of goldenFrames) {
    const path = join(temporaryDirectory, `frame-${frame}.png`);
    await extractFrame(outputPath, frame, path);
    actualFrames.set(frame, path);
    if (process.env.UPDATE_RENDERER_GOLDENS === "1") {
      await copyFile(path, join(goldenDirectory, `frame-${frame}.png`));
    }
  }
}, 120_000);

afterAll(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
});

describe.sequential("FFmpeg product-demo render", () => {
  it("renders the exact video contract through paths containing spaces and Unicode", async () => {
    const metadata = await probeVideo(outputPath);
    expect(metadata).toMatchObject({
      width: 1920,
      height: 1080,
      durationMs: 2000,
      fps: 30,
      codec: "h264",
      pixelFormat: "yuv420p",
      hasAudio: false,
    });
  });

  it("matches neutral, click, zoom-hold, and zoom-exit golden frames", async () => {
    for (const frame of goldenFrames) {
      const actual = actualFrames.get(frame);
      if (!actual) throw new Error(`Actual frame ${frame} was not extracted`);
      const similarity = await frameSimilarity(actual, join(goldenDirectory, `frame-${frame}.png`));
      expect(similarity, `frame ${frame} SSIM`).toBeGreaterThan(0.94);
    }
  });

  it("terminates FFmpeg and removes partial output when cancelled", async () => {
    const interruptedOutput = join(temporaryDirectory, "interrupted render.mp4");
    const controller = new AbortController();
    const rendering = renderProductDemo(renderInput(), {
      outputPath: interruptedOutput,
      assetsDirectory,
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress > 0) controller.abort();
      },
    });
    await expect(rendering).rejects.toThrow();
    await expect(access(interruptedOutput)).rejects.toThrow();
  }, 120_000);
});
