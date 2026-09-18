import type { CanvasOptions } from "@noice-tech/demo-recorder-core";
import { join, resolve } from "node:path";
import { renderDemoVideo, type RenderDemoVideoResult } from "../renderer/index.js";
import { requireFfmpegAssets } from "../support/ffmpeg.js";

export async function renderRecording(
  value: string | undefined,
  options: CanvasOptions & { project?: string; output?: string; overwrite?: boolean } = {},
): Promise<RenderDemoVideoResult> {
  const { project = ".", output, overwrite, ...canvas } = options;
  const projectPath = resolve(project);
  const recordingPath = resolve(value ?? join(projectPath, "recording"));
  return renderDemoVideo(recordingPath, {
    assetsDirectory: requireFfmpegAssets(),
    outputPath: resolve(output ?? join(projectPath, "output.mp4")),
    ...(value === undefined || options.project !== undefined
      ? { presentationPath: join(projectPath, "presentation.json") }
      : {}),
    ...(Object.keys(canvas).length > 0 ? { canvas } : {}),
    ...(overwrite === undefined ? {} : { overwrite }),
  });
}
