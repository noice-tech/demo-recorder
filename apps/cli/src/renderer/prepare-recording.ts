import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  defaultConfig,
  generateZoomSegments,
  loadRecordingManifest,
  resolveBackground,
  resolveCanvas,
  type CanvasOptions,
  type ProductDemoInput,
  type RecordingManifest,
} from "@noice-tech/demo-recorder-core";
import {
  demoPlanBrowserFrameSchema,
  plannedZoomSchema,
  presentationCanvasSchema,
} from "../demo-plan/index.js";

export type PreparedRecording = {
  manifestPath: string;
  recordingDirectory: string;
  videoPath: string;
  manifest: RecordingManifest;
  input: Omit<ProductDemoInput, "videoUrl">;
};

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

export async function prepareRecording(
  recordingPath: string,
  canvasOverride?: CanvasOptions,
): Promise<PreparedRecording> {
  const resolvedInput = resolve(recordingPath);
  const inputStats = await stat(resolvedInput).catch((error: unknown) => {
    throw new Error(`Recording path does not exist: ${resolvedInput}`, { cause: error });
  });
  const manifestPath = inputStats.isDirectory()
    ? join(resolvedInput, "recording.json")
    : resolvedInput;
  const recordingDirectory = await realpath(dirname(manifestPath));
  const manifest = await loadRecordingManifest(manifestPath);

  if (isAbsolute(manifest.video.path)) {
    throw new Error("Recording video path must be relative to recording.json");
  }

  const unresolvedVideoPath = resolve(recordingDirectory, manifest.video.path);
  if (!isInside(recordingDirectory, unresolvedVideoPath)) {
    throw new Error(`Recording video path escapes its directory: ${manifest.video.path}`);
  }

  const videoPath = await realpath(unresolvedVideoPath).catch((error: unknown) => {
    throw new Error(`Recording video is missing: ${unresolvedVideoPath}`, { cause: error });
  });
  if (!isInside(recordingDirectory, videoPath)) {
    throw new Error(`Recording video resolves outside its directory: ${manifest.video.path}`);
  }
  const videoStats = await stat(videoPath);
  if (!videoStats.isFile()) throw new Error(`Recording video is not a file: ${videoPath}`);

  const automaticZoomSegments = generateZoomSegments(
    manifest.events,
    manifest.durationMs,
    defaultConfig.zoom,
  );
  const presentationPath = join(recordingDirectory, "presentation.json");
  const presentationValue = await readFile(presentationPath, "utf8")
    .then(
      (text) =>
        JSON.parse(text) as {
          zoomSegments?: unknown[];
          trimStartMs?: unknown;
          trimEndMs?: unknown;
          canvas?: unknown;
          browserFrame?: unknown;
        },
    )
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw new Error(`Unable to read presentation plan: ${presentationPath}`, { cause: error });
    });
  const plannedZoomSegments = presentationValue?.zoomSegments?.map((segment) =>
    plannedZoomSchema.parse(segment),
  );
  if (
    plannedZoomSegments?.some(
      (segment) =>
        segment.endMs > manifest.durationMs ||
        segment.focusX > manifest.viewport.width ||
        segment.focusY > manifest.viewport.height,
    )
  ) {
    throw new Error("Presentation zoom segment is outside the recording timeline or viewport");
  }
  const zoomSegments = plannedZoomSegments ?? automaticZoomSegments;
  const plannedCanvas = presentationValue?.canvas
    ? presentationCanvasSchema.parse(presentationValue.canvas)
    : undefined;
  const mergedCanvas = canvasOverride
    ? {
        ...plannedCanvas,
        ...(canvasOverride.aspectRatio ? { width: undefined, height: undefined } : {}),
        ...(canvasOverride.width ? { aspectRatio: undefined } : {}),
        ...canvasOverride,
      }
    : plannedCanvas;
  const canvas = resolveCanvas(mergedCanvas, manifest.viewport);
  const browserFrame = presentationValue?.browserFrame
    ? demoPlanBrowserFrameSchema.parse(presentationValue.browserFrame)
    : undefined;
  const firstNavigationMs = manifest.events.find(
    (event) => event.type === "navigation" && event.timestampMs < manifest.durationMs,
  )?.timestampMs;
  const automaticTrimStartMs = firstNavigationMs && firstNavigationMs > 0 ? firstNavigationMs : 0;
  const trimStartMs = presentationValue?.trimStartMs ?? automaticTrimStartMs;
  const trimEndMs = presentationValue?.trimEndMs ?? manifest.durationMs;
  if (
    typeof trimStartMs !== "number" ||
    !Number.isFinite(trimStartMs) ||
    trimStartMs < 0 ||
    typeof trimEndMs !== "number" ||
    !Number.isFinite(trimEndMs) ||
    trimEndMs > manifest.durationMs ||
    trimEndMs <= trimStartMs
  ) {
    throw new Error("Presentation trim range is outside the recording timeline");
  }

  return {
    manifestPath,
    recordingDirectory,
    videoPath,
    manifest,
    input: {
      recording: manifest,
      timeline: {
        zoomSegments,
        ...(trimStartMs === 0 ? {} : { trimStartMs }),
        ...(trimEndMs === manifest.durationMs ? {} : { trimEndMs }),
      },
      config: {
        ...defaultConfig.render,
        ...canvas,
        background: resolveBackground(mergedCanvas?.background),
        browserFrameTheme: browserFrame?.theme ?? defaultConfig.render.browserFrameTheme,
        cursorEnabled: defaultConfig.cursor.enabled,
        zoom: {
          enterDurationMs: defaultConfig.zoom.enterDurationMs,
          exitDurationMs: defaultConfig.zoom.exitDurationMs,
        },
      },
    },
  };
}
