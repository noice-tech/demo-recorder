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

export async function runInspect(args: ParsedArguments): Promise<unknown> {
  const video = args.positionals[0];
  if (!video) throw new Error("Missing video argument for inspect");

  const metadata = await probeVideo(video, { ffprobePath: findFfprobe() });
  let contactSheet: string | undefined;
  if (booleanOption(args, "contact-sheet")) {
    contactSheet =
      stringOption(args, "output") ?? `${video.replace(/\.[^./]+$/, "")}-contact-sheet.png`;
    await runProcess(findFfmpeg(), [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      video,
      "-vf",
      "fps=2,scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2,tile=4x3:padding=4:margin=4",
      "-frames:v",
      "1",
      "-update",
      "1",
      "-y",
      contactSheet,
    ]);
  }

  return { video, ...metadata, ...(contactSheet ? { contactSheet } : {}) };
}
