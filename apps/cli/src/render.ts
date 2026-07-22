import { isAbsolute, join, resolve, sep } from "node:path";
import { renderDemoVideo, type RenderDemoVideoResult } from "./renderer/index.js";
import { requireRemotionBundle, workingDirectory } from "./paths.js";

export function resolveRecordingArgument(value: string): string {
  if (isAbsolute(value)) return value;
  if (value.startsWith(".") || value.includes(sep) || value.includes("/")) {
    return resolve(workingDirectory, value);
  }
  return join(workingDirectory, "recordings", value);
}

export async function renderRecording(value: string): Promise<RenderDemoVideoResult> {
  const recordingPath = resolveRecordingArgument(value);
  console.log(`[demo-recorder] Loading recording: ${recordingPath}`);
  return renderDemoVideo(recordingPath, {
    compositionPath: requireRemotionBundle(),
    outputDirectory: join(workingDirectory, "output"),
  });
}
