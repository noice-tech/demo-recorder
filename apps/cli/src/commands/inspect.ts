import { probeVideo, runProcess } from "@noice-tech/demo-recorder-renderer";
import {
  booleanOption,
  stringOption,
  type OptionDefinitions,
  type ParsedArguments,
} from "../support/args.js";
import { findFfmpeg, findFfprobe } from "../support/ffmpeg.js";

export const inspectOptions: OptionDefinitions = {
  "contact-sheet": { type: "boolean" },
  output: { type: "string" },
};

const SHEET_COLUMNS = 4;
const SHEET_ROWS = 3;
const SHEET_FRAMES = SHEET_COLUMNS * SHEET_ROWS;
const FALLBACK_FPS = 60;

export type ContactSheetSample = { frame: number; timeMs: number };

/**
 * Picks frames spread evenly over the whole video, always including the first
 * and the last frame, so the sheet shows the opening state and the final result.
 */
export function contactSheetSamples(
  durationMs: number,
  fps: number,
  count = SHEET_FRAMES,
): ContactSheetSample[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("Video duration must be positive");
  }
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("Video frame rate must be positive");
  // Constant-rate renders have duration = frames / fps up to ffprobe's microsecond
  // rounding, so rounding recovers the exact frame count. If a variable-rate input
  // overshoots, the tile filter still flushes the frames it received at EOF.
  const frameCount = Math.max(1, Math.round((durationMs * fps) / 1_000));
  const lastFrame = frameCount - 1;
  const slots = Math.max(1, Math.min(count, frameCount));
  const frames = new Set<number>();
  for (let index = 0; index < slots; index += 1) {
    frames.add(slots === 1 ? 0 : Math.round((index * lastFrame) / (slots - 1)));
  }
  return [...frames].map((frame) => ({ frame, timeMs: Math.round((frame * 1_000) / fps) }));
}

function contactSheetFilter(samples: readonly ContactSheetSample[]): string {
  const selection = samples.map((sample) => `eq(n\\,${sample.frame})`).join("+");
  return [
    `select='${selection}'`,
    "scale=480:270:force_original_aspect_ratio=decrease",
    "pad=480:270:(ow-iw)/2:(oh-ih)/2",
    `tile=${SHEET_COLUMNS}x${SHEET_ROWS}:padding=4:margin=4:nb_frames=${samples.length}`,
  ].join(",");
}

export async function runInspect(args: ParsedArguments): Promise<unknown> {
  const video = args.positionals[0];
  if (!video) throw new Error("Missing video argument for inspect");

  const metadata = await probeVideo(video, { ffprobePath: findFfprobe() });
  if (!booleanOption(args, "contact-sheet")) return { video, ...metadata };

  const contactSheet =
    stringOption(args, "output") ?? `${video.replace(/\.[^./]+$/, "")}-contact-sheet.png`;
  const samples = contactSheetSamples(metadata.durationMs, metadata.fps ?? FALLBACK_FPS);
  await runProcess(findFfmpeg(), [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    video,
    "-vf",
    contactSheetFilter(samples),
    "-fps_mode",
    "passthrough",
    "-frames:v",
    "1",
    "-update",
    "1",
    "-y",
    contactSheet,
  ]);

  return {
    video,
    ...metadata,
    contactSheet,
    // Tiles read left to right, top to bottom.
    contactSheetTimesMs: samples.map((sample) => sample.timeMs),
  };
}
