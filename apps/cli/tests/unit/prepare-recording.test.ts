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
      guarded: true,
      cursor: "synthetic",
      video: { path: videoPath, width: 1440, height: 900 },
      events: [
        { type: "navigation", timestampMs: 80, step: 1, url: "https://example.com" },
        { type: "cursor-move", timestampMs: 100, step: 1, x: 20, y: 20 },
        { type: "click", timestampMs: 500, step: 2, x: 300, y: 250, button: "left" },
      ],
    }),
  );
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("prepareRecording", () => {
  it("validates the recording and defaults to no trim or zooms", async () => {
    const directory = await createRecording();
    await writeFile(join(directory, "browser.webm"), Buffer.from("0123456789"));

    const prepared = await prepareRecording(directory);

    expect(prepared.manifest.id).toBe("renderer-test");
    expect(prepared.input.timeline).toEqual({ zoomSegments: [] });
    expect(prepared.input.config).toMatchObject({ fps: 60, browserFrameTheme: "dark" });
    expect(prepared.videoPath).toBe(await realpath(join(directory, "browser.webm")));
  });

  it("resolves anchored zooms and trim against recorded steps", async () => {
    const directory = await createRecording();
    await writeFile(join(directory, "browser.webm"), Buffer.from("video"));
    await writeFile(
      join(directory, "presentation.json"),
      JSON.stringify({
        version: 1,
        zooms: [{ step: 2, leadMs: 100, holdMs: 400, scale: 1.2 }],
        trim: { from: { step: 1 }, to: { anchor: "end" } },
      }),
    );

    const prepared = await prepareRecording(directory);
    expect(prepared.input.timeline).toEqual({
      zoomSegments: [{ startMs: 400, endMs: 900, focusX: 300, focusY: 250, scale: 1.2 }],
      trimStartMs: 80,
    });
    expect(prepared.manifest.events).toHaveLength(3);
  });

  it("resolves saved canvas settings and lets CLI dimensions override their ratio", async () => {
    const directory = await createRecording();
    await writeFile(join(directory, "browser.webm"), Buffer.from("video"));
    await writeFile(
      join(directory, "presentation.json"),
      JSON.stringify({
        version: 1,
        canvas: { aspectRatio: "1:1", padding: 72, background: "#123456" },
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
      JSON.stringify({ version: 1, trim: { from: { step: 1 }, to: { step: 2, offsetMs: 2000 } } }),
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
