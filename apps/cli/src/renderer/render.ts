import { dirname, join, resolve } from "node:path";
import type { CanvasOptions } from "@noice-tech/demo-recorder-core";
import { renderProductDemo } from "@noice-tech/demo-recorder-renderer";
import { prepareRecording } from "./prepare-recording.js";

export type RenderDemoVideoOptions = {
  assetsDirectory: string;
  outputPath?: string;
  outputDirectory?: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  signal?: AbortSignal;
  log?: (message: string) => void;
  canvas?: CanvasOptions;
  presentationPath?: string;
  overwrite?: boolean;
};

export type RenderDemoVideoResult = {
  recordingId: string;
  outputPath: string;
  zoomSegmentCount: number;
};

function stageError(stage: string, error: unknown): Error {
  return new Error(`${stage} failed`, { cause: error });
}

function safeOutputName(id: string): string {
  return id.replaceAll(/[^A-Za-z0-9._-]/g, "-");
}

export async function renderDemoVideo(
  recordingPath: string,
  options: RenderDemoVideoOptions,
): Promise<RenderDemoVideoResult> {
  const log = options.log ?? ((message: string) => console.error(`[demo-recorder] ${message}`));
  const prepared = await prepareRecording(
    recordingPath,
    options.canvas,
    options.presentationPath,
  ).catch((error: unknown) => {
    throw stageError("Recording preparation", error);
  });
  const zoomSegmentCount = prepared.input.timeline.zoomSegments.length;
  log(`Generated ${zoomSegmentCount} zoom segment${zoomSegmentCount === 1 ? "" : "s"}`);
  const background = prepared.input.config.background;
  log(
    `Background: ${
      background.type === "color"
        ? background.color
        : `gradient (${background.stops.map((stop) => stop.color).join(", ")})`
    }`,
  );

  const outputPath = resolve(
    options.outputPath ??
      (options.outputDirectory
        ? join(options.outputDirectory, `${safeOutputName(prepared.manifest.id)}.mp4`)
        : join(dirname(prepared.recordingDirectory), "output.mp4")),
  );
  const signalController = options.signal ? undefined : new AbortController();
  const abortRender = () => signalController?.abort(new Error("Render interrupted"));
  if (signalController) {
    process.once("SIGINT", abortRender);
    process.once("SIGTERM", abortRender);
  }
  const renderSignal = options.signal ?? signalController?.signal;
  let lastReportedPercent = -10;
  try {
    await renderProductDemo(
      {
        sourcePath: prepared.videoPath,
        recording: prepared.input.recording,
        timeline: prepared.input.timeline,
        config: prepared.input.config,
      },
      {
        outputPath,
        assetsDirectory: options.assetsDirectory,
        overwrite: options.overwrite ?? false,
        ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}),
        ...(options.ffprobePath ? { ffprobePath: options.ffprobePath } : {}),
        ...(renderSignal ? { signal: renderSignal } : {}),
        log,
        onProgress: (progress) => {
          const percent = Math.floor((progress * 100) / 10) * 10;
          if (percent >= lastReportedPercent + 10 || percent === 100) {
            lastReportedPercent = percent;
            log(`Render progress: ${percent}%`);
          }
        },
      },
    );
  } catch (error) {
    throw stageError("FFmpeg MP4 render", error);
  } finally {
    if (signalController) {
      process.off("SIGINT", abortRender);
      process.off("SIGTERM", abortRender);
    }
  }

  log(`Rendered video: ${outputPath}`);
  return { recordingId: prepared.manifest.id, outputPath, zoomSegmentCount };
}
