import { readFile } from "node:fs/promises";
import { parseMedia } from "@remotion/media-parser";

export type VideoMetadata = { width: number; height: number; durationMs: number };

export async function probeVideo(path: string): Promise<VideoMetadata> {
  try {
    const bytes = await readFile(path);
    const parsed = await parseMedia({
      src: new Blob([bytes]),
      fields: { dimensions: true, durationInSeconds: true },
      acknowledgeRemotionLicense: true,
    });
    const durationMs = (parsed.durationInSeconds ?? 0) * 1000;
    if (!parsed.dimensions || !Number.isFinite(durationMs) || durationMs <= 0) {
      throw new Error("Media parser returned incomplete video metadata");
    }
    return {
      width: parsed.dimensions.width,
      height: parsed.dimensions.height,
      durationMs,
    };
  } catch (error) {
    throw new Error(`Unable to inspect recorded video metadata at ${path}`, { cause: error });
  }
}
