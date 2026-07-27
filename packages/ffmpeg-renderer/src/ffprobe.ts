import { z } from "zod";
import { runProcess } from "./process.js";

const streamSchema = z.object({
  codec_type: z.string().optional(),
  codec_name: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  avg_frame_rate: z.string().optional(),
  r_frame_rate: z.string().optional(),
  duration: z.string().optional(),
  pix_fmt: z.string().optional(),
  sample_rate: z.string().optional(),
  channels: z.number().int().positive().optional(),
});

const probeSchema = z.object({
  streams: z.array(streamSchema).default([]),
  format: z
    .object({ duration: z.string().optional(), format_name: z.string().optional() })
    .passthrough()
    .optional(),
});

export type ProbedVideo = {
  width: number;
  height: number;
  durationMs: number;
  fps?: number;
  codec?: string;
  pixelFormat?: string;
  container?: string;
  hasAudio: boolean;
};

function parseRate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const [numeratorText, denominatorText = "1"] = value.split("/");
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText);
  const rate = numerator / denominator;
  return Number.isFinite(rate) && rate > 0 ? rate : undefined;
}

export function parseFfprobeOutput(input: unknown, path = "media"): ProbedVideo {
  const parsed = probeSchema.parse(input);
  const video = parsed.streams.find((stream) => stream.codec_type === "video");
  if (!video?.width || !video.height) throw new Error(`ffprobe found no video stream in ${path}`);
  const durationSeconds = Number(video.duration ?? parsed.format?.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(`ffprobe returned no positive duration for ${path}`);
  }
  const fps = parseRate(video.avg_frame_rate ?? video.r_frame_rate);
  return {
    width: video.width,
    height: video.height,
    durationMs: durationSeconds * 1000,
    ...(fps ? { fps } : {}),
    ...(video.codec_name ? { codec: video.codec_name } : {}),
    ...(video.pix_fmt ? { pixelFormat: video.pix_fmt } : {}),
    ...(parsed.format?.format_name ? { container: parsed.format.format_name } : {}),
    hasAudio: parsed.streams.some((stream) => stream.codec_type === "audio"),
  };
}

export async function probeVideo(
  path: string,
  options: { ffprobePath?: string; signal?: AbortSignal } = {},
): Promise<ProbedVideo> {
  const ffprobePath = options.ffprobePath ?? process.env.DEMO_RECORDER_FFPROBE ?? "ffprobe";
  const processOptions = options.signal ? { signal: options.signal } : {};
  const result = await runProcess(
    ffprobePath,
    ["-v", "error", "-show_streams", "-show_format", "-of", "json", path],
    processOptions,
  );
  return parseFfprobeOutput(JSON.parse(result.stdout) as unknown, path);
}
