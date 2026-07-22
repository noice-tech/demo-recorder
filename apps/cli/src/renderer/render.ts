import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { chromium } from "playwright";
import type { ProductDemoInput } from "@noice-tech/demo-recorder-core";
import { prepareRecording, startAssetServer, type AssetServer } from "./prepare-assets.js";

export type RenderDemoVideoOptions = {
  compositionPath: string;
  outputPath?: string;
  outputDirectory?: string;
  log?: (message: string) => void;
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
  const log = options.log ?? ((message: string) => console.log(`[demo-recorder] ${message}`));
  let prepared: Awaited<ReturnType<typeof prepareRecording>>;
  try {
    prepared = await prepareRecording(recordingPath);
  } catch (error) {
    throw stageError("Recording preparation", error);
  }

  const compositionPath = resolve(options.compositionPath);
  const compositionStats = await stat(join(compositionPath, "index.html")).catch(
    (error: unknown) => {
      throw stageError(`Remotion composition not found at ${compositionPath}`, error);
    },
  );
  if (!compositionStats.isFile()) {
    throw new Error(`Remotion composition index is not a file: ${compositionPath}`);
  }

  const zoomSegmentCount = prepared.input.timeline.zoomSegments.length;
  log(`Generated ${zoomSegmentCount} zoom segment${zoomSegmentCount === 1 ? "" : "s"}`);

  const outputPath = resolve(
    options.outputPath ??
      join(
        options.outputDirectory ?? join(process.cwd(), "output"),
        `${safeOutputName(prepared.manifest.id)}.mp4`,
      ),
  );
  await mkdir(dirname(outputPath), { recursive: true });

  let assetServer: AssetServer | undefined;
  let completed = false;
  try {
    try {
      assetServer = await startAssetServer(prepared.videoPath);
    } catch (error) {
      throw stageError("Asset server startup", error);
    }

    const input: ProductDemoInput = {
      ...prepared.input,
      videoUrl: assetServer.videoUrl,
    };
    const inputProps = input as unknown as Record<string, unknown>;

    const browserExecutable = chromium.executablePath();
    let composition: Awaited<ReturnType<typeof selectComposition>>;
    try {
      log("Selecting ProductDemo composition");
      composition = await selectComposition({
        browserExecutable,
        serveUrl: compositionPath,
        id: "ProductDemo",
        inputProps,
      });
    } catch (error) {
      throw stageError("Composition selection", error);
    }

    try {
      log(`Rendering H.264 MP4 to ${outputPath}`);
      let lastReportedPercent = -10;
      await renderMedia({
        browserExecutable,
        serveUrl: compositionPath,
        composition,
        codec: "h264",
        pixelFormat: "yuv420p",
        outputLocation: outputPath,
        inputProps,
        overwrite: true,
        onProgress: ({ progress }) => {
          const percent = Math.floor((progress * 100) / 10) * 10;
          if (percent >= lastReportedPercent + 10 || percent === 100) {
            lastReportedPercent = percent;
            log(`Render progress: ${percent}%`);
          }
        },
      });
      completed = true;
    } catch (error) {
      throw stageError("MP4 render", error);
    }
  } finally {
    if (!completed) await rm(outputPath, { force: true }).catch(() => undefined);
    if (assetServer) await assetServer.close().catch(() => undefined);
  }

  log(`Rendered video: ${outputPath}`);
  return { recordingId: prepared.manifest.id, outputPath, zoomSegmentCount };
}
