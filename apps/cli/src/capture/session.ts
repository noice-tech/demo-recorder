import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  parseRecordingManifest,
  type RecordingEvent,
  type RecordingManifest,
} from "@noice-tech/demo-recorder-core";
import type { Page } from "playwright";
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
  const browserVideoPath = join(outputDirectory, "browser.webm");
  await mkdir(artifactsDirectory);
  let recordingBrowser: Awaited<ReturnType<typeof createRecordingBrowser>>;
  try {
    recordingBrowser = await createRecordingBrowser(options);
  } catch (error) {
    await rm(outputDirectory, { recursive: true, force: true });
    throw error;
  }

  const createdAt = new Date().toISOString();
  let page: Page;
  let firstFrameAtNs: bigint | undefined;
  let resolveFirstFrame: (() => void) | undefined;
  const firstFrameReceived = new Promise<void>((resolveFrame) => {
    resolveFirstFrame = resolveFrame;
  });
  try {
    page = await recordingBrowser.context.newPage();
    await page.screencast.start({
      path: browserVideoPath,
      size: options.viewport,
      onFrame: () => {
        if (firstFrameAtNs !== undefined) return;
        firstFrameAtNs = process.hrtime.bigint();
        resolveFirstFrame?.();
      },
    });
    await Promise.race([
      firstFrameReceived,
      page.waitForTimeout(5_000).then(() => {
        throw new Error("Timed out waiting for the first recorded browser frame");
      }),
    ]);
  } catch (error) {
    try {
      await recordingBrowser.context.close();
    } finally {
      await recordingBrowser.browser.close();
      await rm(outputDirectory, { recursive: true, force: true });
    }
    throw new Error("Unable to create the recording page", { cause: error });
  }
  if (firstFrameAtNs === undefined) throw new Error("Recording did not establish a video clock");
  const tracker = createInteractionTracker(firstFrameAtNs);
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

  // A frame commits before the browser has painted the destination, so using
  // framenavigated here leaves blank navigation frames at the start of renders.
  // DOMContentLoaded is the first reliable point at which the page is renderable.
  page.on("domcontentloaded", () => {
    const url = page.url();
    if (url === "about:blank") return;
    tracker.push({ type: "navigation", url });
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

    try {
      await page.screencast.stop();
      await closeBrowser();
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
