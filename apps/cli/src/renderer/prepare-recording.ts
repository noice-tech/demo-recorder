import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  buildTimeline,
  canvasToOptions,
  parsePresentation,
  parseRecording,
  resolveRenderConfig,
  type CanvasOptions,
  type Presentation,
  type ProductDemoInput,
  type Recording,
} from "@noice-tech/demo-recorder-core";

export type PreparedRecording = {
  manifestPath: string;
  recordingDirectory: string;
  videoPath: string;
  manifest: Recording;
  presentation: Presentation | undefined;
  input: Omit<ProductDemoInput, "videoUrl">;
};

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

async function firstExisting(paths: string[], message: string): Promise<string> {
  for (const path of paths) {
    if (
      await stat(path).then(
        (value) => value.isFile(),
        () => false,
      )
    )
      return path;
  }
  throw new Error(message);
}

async function loadPresentation(paths: string[]): Promise<Presentation | undefined> {
  for (const path of paths) {
    try {
      return parsePresentation(JSON.parse(await readFile(path, "utf8")) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new Error(`Invalid presentation at ${path}`, { cause: error });
    }
  }
  return undefined;
}

function mergeCanvas(
  base: CanvasOptions | undefined,
  override: CanvasOptions | undefined,
): CanvasOptions | undefined {
  if (!override) return base;
  return {
    ...base,
    ...override,
    ...(override.aspectRatio ? { width: undefined, height: undefined } : {}),
    ...(override.width !== undefined || override.height !== undefined
      ? { aspectRatio: undefined }
      : {}),
  };
}

export async function prepareRecording(
  recordingPath: string,
  canvasOverride?: CanvasOptions,
  presentationOverride?: string,
): Promise<PreparedRecording> {
  const resolvedInput = resolve(recordingPath);
  const inputStats = await stat(resolvedInput).catch((error: unknown) => {
    throw new Error(`Recording path does not exist: ${resolvedInput}`, { cause: error });
  });
  const manifestPath = inputStats.isDirectory()
    ? await firstExisting(
        [join(resolvedInput, "events.json"), join(resolvedInput, "recording.json")],
        `No events.json or recording.json in ${resolvedInput}`,
      )
    : resolvedInput;
  const recordingDirectory = await realpath(dirname(manifestPath));
  const recording = parseRecording(JSON.parse(await readFile(manifestPath, "utf8")) as unknown);

  if (isAbsolute(recording.video.path)) {
    throw new Error("Recording video path must be relative to its manifest");
  }

  const unresolvedVideoPath = resolve(recordingDirectory, recording.video.path);
  if (!isInside(recordingDirectory, unresolvedVideoPath)) {
    throw new Error(`Recording video path escapes its directory: ${recording.video.path}`);
  }

  const videoPath = await realpath(unresolvedVideoPath).catch((error: unknown) => {
    throw new Error(`Recording video is missing: ${unresolvedVideoPath}`, { cause: error });
  });
  if (!isInside(recordingDirectory, videoPath)) {
    throw new Error(`Recording video resolves outside its directory: ${recording.video.path}`);
  }
  if (!(await stat(videoPath)).isFile()) {
    throw new Error(`Recording video is not a file: ${videoPath}`);
  }

  const presentationCandidates = [
    ...(presentationOverride ? [resolve(presentationOverride)] : []),
    join(recordingDirectory, "presentation.json"),
    join(dirname(recordingDirectory), "presentation.json"),
  ];
  const presentation = await loadPresentation(presentationCandidates);

  const timeline = buildTimeline(presentation, recording);
  const canvas = mergeCanvas(canvasToOptions(presentation?.canvas), canvasOverride);
  const config = resolveRenderConfig({
    viewport: recording.viewport,
    canvas,
    ...(presentation?.browserFrame ? { browserFrameTheme: presentation.browserFrame.theme } : {}),
  });

  return {
    manifestPath,
    recordingDirectory,
    videoPath,
    manifest: recording,
    presentation,
    input: { recording, timeline, config },
  };
}
