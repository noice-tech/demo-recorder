import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  parseRecordingManifest,
  type RecordingEvent,
  type RecordingManifest,
} from "@noice-tech/demo-recorder-core";
import type { Page, Video } from "playwright";
import { createActions } from "./actions.js";
import { createRecordingBrowser } from "./create-browser.js";
import { createInteractionTracker } from "./interaction-tracker.js";
import { probeVideo } from "./media-metadata.js";
import type { RecordingSession, RecordingSessionOptions } from "./types.js";

type SessionState = "active" | "stopping" | "stopped" | "aborted";

export async function createRecordingSession(
  options: RecordingSessionOptions,
): Promise<RecordingSession> {
  const outputDirectory = resolve(options.outputDirectory);
  await mkdir(dirname(outputDirectory), { recursive: true });
  try {
    await mkdir(outputDirectory);
  } catch (error) {
    throw new Error(`Recording directory already exists: ${outputDirectory}`, { cause: error });
  }

  const artifactsDirectory = join(outputDirectory, "artifacts");
  const rawVideoDirectory = join(artifactsDirectory, "playwright-video");
  let recordingBrowser: Awaited<ReturnType<typeof createRecordingBrowser>>;
  try {
    recordingBrowser = await createRecordingBrowser(options, rawVideoDirectory);
  } catch (error) {
    await rm(outputDirectory, { recursive: true, force: true });
    throw error;
  }

  const startedAtNs = process.hrtime.bigint();
  const createdAt = new Date().toISOString();
  const tracker = createInteractionTracker(startedAtNs);
  let page: Page;
  try {
    page = await recordingBrowser.context.newPage();
  } catch (error) {
    try {
      await recordingBrowser.context.close();
    } finally {
      await recordingBrowser.browser.close();
      await rm(outputDirectory, { recursive: true, force: true });
    }
    throw new Error("Unable to create the recording page", { cause: error });
  }
  const video: Video | null = page.video();
  const cursor = { x: 32, y: 32 };
  tracker.push({ type: "cursor-move", ...cursor });
  const actionContext = {
    page,
    tracker,
    cursor,
    viewport: options.viewport,
    movementIndex: 0,
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
  };
  const actions = createActions(actionContext);
  let state: SessionState = "active";

  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame() || frame.url() === "about:blank") return;
    tracker.push({ type: "navigation", url: frame.url() });
  });

  const closeBrowser = async (): Promise<void> => {
    try {
      await recordingBrowser.context.close();
    } finally {
      await recordingBrowser.browser.close();
    }
  };

  const abort = async (): Promise<void> => {
    if (state === "aborted") return;
    if (state === "stopped") throw new Error("Cannot abort a stopped recording session");
    state = "aborted";
    try {
      await closeBrowser();
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  };

  const stop = async (): Promise<RecordingManifest> => {
    if (state !== "active") throw new Error(`Cannot stop recording session in state: ${state}`);
    state = "stopping";
    const browserVideoPath = join(outputDirectory, "browser.webm");

    try {
      // Playwright finalizes video when the context closes, but saveAs still
      // needs the browser connection to remain alive.
      await recordingBrowser.context.close();
      try {
        if (!video) throw new Error("Playwright did not provide a video handle");
        await video.saveAs(browserVideoPath);
      } finally {
        await recordingBrowser.browser.close();
      }
      const metadata = await probeVideo(browserVideoPath);
      const durationMs = metadata.durationMs;
      const events: RecordingEvent[] = tracker.events().map((event) => ({
        ...event,
        timestampMs: Math.min(event.timestampMs, durationMs),
      }));
      const manifest = parseRecordingManifest({
        version: 1,
        id: basename(outputDirectory),
        createdAt,
        durationMs,
        viewport: options.viewport,
        video: {
          path: "browser.webm",
          width: metadata.width,
          height: metadata.height,
          durationMs,
        },
        events,
      });

      await writeFile(
        join(outputDirectory, "recording.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8",
      );
      await writeFile(
        join(outputDirectory, "metadata.json"),
        `${JSON.stringify({ recorder: "playwright", eventCount: events.length }, null, 2)}\n`,
        "utf8",
      );
      await rm(rawVideoDirectory, { recursive: true, force: true });
      state = "stopped";
      return manifest;
    } catch (error) {
      state = "aborted";
      await rm(outputDirectory, { recursive: true, force: true });
      throw new Error(`Recording finalization failed for ${outputDirectory}`, { cause: error });
    }
  };

  return {
    page,
    actions,
    outputDirectory,
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    stop,
    abort,
  };
}
