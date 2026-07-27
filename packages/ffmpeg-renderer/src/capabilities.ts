import { runProcess } from "./process.js";

const REQUIRED_FILTERS = [
  "alphaextract",
  "alphamerge",
  "ass",
  "color",
  "colorspace",
  "format",
  "fps",
  "overlay",
  "scale",
  "setpts",
  "setsar",
  "trim",
] as const;

const H264_ENCODERS = [
  "libx264",
  "h264_videotoolbox",
  "h264_nvenc",
  "h264_qsv",
  "h264_vaapi",
] as const;

export type FfmpegCapabilities = {
  ffmpegPath: string;
  ffprobePath: string;
  ffmpegVersion?: string;
  ffprobeVersion?: string;
  filters: string[];
  missingFilters: string[];
  h264Encoders: string[];
  ready: boolean;
  errors: string[];
};

function firstVersionLine(output: string): string | undefined {
  const value = output.split(/\r?\n/, 1)[0]?.trim();
  return value || undefined;
}

export function parseFfmpegFilters(output: string): Set<string> {
  const result = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*[TSC.]{3}\s+(\S+)\s/.exec(line);
    if (match?.[1] && match[1] !== "=") result.add(match[1]);
  }
  return result;
}

export function parseFfmpegEncoders(output: string): Set<string> {
  const result = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*[VAS.][FSXBD.]{5}\s+(\S+)\s/.exec(line);
    if (match?.[1] && match[1] !== "=") result.add(match[1]);
  }
  return result;
}

export async function inspectFfmpegCapabilities(
  options: {
    ffmpegPath?: string;
    ffprobePath?: string;
  } = {},
): Promise<FfmpegCapabilities> {
  const ffmpegPath = options.ffmpegPath ?? process.env.DEMO_RECORDER_FFMPEG ?? "ffmpeg";
  const ffprobePath = options.ffprobePath ?? process.env.DEMO_RECORDER_FFPROBE ?? "ffprobe";
  const errors: string[] = [];
  const ffmpegVersionResult = await runProcess(ffmpegPath, ["-version"]).catch((error: unknown) => {
    errors.push(`FFmpeg unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  });
  const ffprobeVersionResult = await runProcess(ffprobePath, ["-version"]).catch(
    (error: unknown) => {
      errors.push(`ffprobe unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    },
  );
  const filtersResult = ffmpegVersionResult
    ? await runProcess(ffmpegPath, ["-hide_banner", "-filters"]).catch((error: unknown) => {
        errors.push(`Unable to inspect FFmpeg filters: ${String(error)}`);
        return undefined;
      })
    : undefined;
  const encodersResult = ffmpegVersionResult
    ? await runProcess(ffmpegPath, ["-hide_banner", "-encoders"]).catch((error: unknown) => {
        errors.push(`Unable to inspect FFmpeg encoders: ${String(error)}`);
        return undefined;
      })
    : undefined;
  const filters = parseFfmpegFilters(filtersResult?.stdout ?? "");
  const encoders = parseFfmpegEncoders(encodersResult?.stdout ?? "");
  const ffmpegVersion = firstVersionLine(ffmpegVersionResult?.stdout ?? "");
  const ffprobeVersion = firstVersionLine(ffprobeVersionResult?.stdout ?? "");
  const missingFilters = REQUIRED_FILTERS.filter((name) => !filters.has(name));
  const h264Encoders = H264_ENCODERS.filter((name) => encoders.has(name));
  if (missingFilters.length > 0)
    errors.push(`Missing FFmpeg filters: ${missingFilters.join(", ")}`);
  if (h264Encoders.length === 0) errors.push("No supported H.264 encoder found");
  return {
    ffmpegPath,
    ffprobePath,
    ...(ffmpegVersion ? { ffmpegVersion } : {}),
    ...(ffprobeVersion ? { ffprobeVersion } : {}),
    filters: [...filters],
    missingFilters,
    h264Encoders,
    ready:
      Boolean(ffmpegVersionResult) &&
      Boolean(ffprobeVersionResult) &&
      missingFilters.length === 0 &&
      h264Encoders.length > 0,
    errors,
  };
}

export const ffmpegCapabilityRequirements = {
  filters: REQUIRED_FILTERS,
  h264Encoders: H264_ENCODERS,
};
