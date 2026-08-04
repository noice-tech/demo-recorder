import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { prepareRecording } from "../../src/renderer/index.js";

const temporaryDirectories: string[] = [];

async function createRecording(videoPath = "browser.webm") {
  const directory = await mkdtemp(join(tmpdir(), "demo-recorder-renderer-test-"));
  temporaryDirectories.push(directory);
  await writeFile(
    join(directory, "recording.json"),
    JSON.stringify({
      version: 1,
      id: "renderer-test",
      createdAt: "2026-07-19T00:00:00.000Z",
      durationMs: 1000,
      viewport: { width: 1440, height: 900 },
      video: { path: videoPath, width: 1440, height: 900, durationMs: 1000 },
      events: [
        { type: "navigation", timestampMs: 80, url: "https://example.com" },
        { type: "cursor-move", timestampMs: 100, x: 20, y: 20 },
        { type: "click", timestampMs: 500, x: 300, y: 250, button: "left" },
      ],
    }),
  );
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("prepareRecording", () => {
  it("validates the recording and generates presentation timeline data", async () => {
    const directory = await createRecording();
    await writeFile(join(directory, "browser.webm"), Buffer.from("0123456789"));

    const prepared = await prepareRecording(directory);

    expect(prepared.manifest.id).toBe("renderer-test");
    expect(prepared.input.timeline.zoomSegments).toHaveLength(0);
    expect(prepared.input.timeline.trimStartMs).toBe(80);
    expect(prepared.input.config).toMatchObject({ fps: 60, browserFrameTheme: "dark" });
    expect(prepared.videoPath).toBe(await realpath(join(directory, "browser.webm")));
  });

  it("uses validated presentation zoom overrides without changing the manifest", async () => {
    const directory = await createRecording();
    await writeFile(join(directory, "browser.webm"), Buffer.from("video"));
    await writeFile(
      join(directory, "presentation.json"),
      JSON.stringify({
        zoomSegments: [{ startMs: 100, endMs: 900, focusX: 100, focusY: 200, scale: 1.2 }],
        trimStartMs: 100,
        trimEndMs: 900,
      }),
    );

    const prepared = await prepareRecording(directory);
    expect(prepared.input.timeline).toEqual({
      zoomSegments: [{ startMs: 100, endMs: 900, focusX: 100, focusY: 200, scale: 1.2 }],
      trimStartMs: 100,
      trimEndMs: 900,
    });
    expect(prepared.manifest.events).toHaveLength(3);
  });

  it("resolves saved canvas settings and lets CLI dimensions override their ratio", async () => {
    const directory = await createRecording();
    await writeFile(join(directory, "browser.webm"), Buffer.from("video"));
    await writeFile(
      join(directory, "presentation.json"),
      JSON.stringify({
        canvas: {
          aspectRatio: "1:1",
          padding: 72,
          background: { type: "color", color: "#123456" },
        },
        browserFrame: { theme: "light" },
      }),
    );

    const square = await prepareRecording(directory);
    expect(square.input.config).toMatchObject({
      width: 1080,
      height: 1080,
      padding: 72,
      background: { type: "color", color: "#123456" },
      browserFrameTheme: "light",
    });
    const explicit = await prepareRecording(directory, { width: 1600, height: 1000 });
    expect(explicit.input.config).toMatchObject({ width: 1600, height: 1000, padding: 72 });
  });

  it("rejects presentation trims outside the source duration", async () => {
    const directory = await createRecording();
    await writeFile(join(directory, "browser.webm"), Buffer.from("video"));
    await writeFile(
      join(directory, "presentation.json"),
      JSON.stringify({ trimStartMs: 900, trimEndMs: 1200 }),
    );
    await expect(prepareRecording(directory)).rejects.toThrow("trim range");
  });

  it("reports a missing recording video", async () => {
    const directory = await createRecording();
    await expect(prepareRecording(directory)).rejects.toThrow("Recording video is missing");
  });

  it("rejects video paths outside the recording directory", async () => {
    const directory = await createRecording("../outside.webm");
    await expect(prepareRecording(directory)).rejects.toThrow("escapes its directory");
  });
});
