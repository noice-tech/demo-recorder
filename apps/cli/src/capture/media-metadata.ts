import { probeVideo as probeFfmpegVideo } from "@noice-tech/demo-recorder-ffmpeg";

export type VideoMetadata = { width: number; height: number; durationMs: number };

export async function probeVideo(path: string): Promise<VideoMetadata> {
  try {
    const parsed = await probeFfmpegVideo(path);
    return {
      width: parsed.width,
      height: parsed.height,
      durationMs: parsed.durationMs,
    };
  } catch (error) {
    throw new Error(`Unable to inspect recorded video metadata at ${path}`, { cause: error });
  }
}
