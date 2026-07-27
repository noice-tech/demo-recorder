import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { probeVideo } from "@noice-tech/demo-recorder-ffmpeg";
import { stringOption, type ParsedArguments } from "./arguments.js";
import { workingDirectory } from "./paths.js";

function runFfmpeg(arguments_: string[]): Promise<void> {
  const executable = process.env.DEMO_RECORDER_FFMPEG ?? "ffmpeg";
  return new Promise((resolveRun, reject) => {
    const child = spawn(executable, arguments_, { stdio: ["ignore", "ignore", "pipe"] });
    let errors = "";
    child.stderr.on("data", (chunk: Buffer) => {
      errors += chunk.toString();
    });
    child.once("error", (error) => {
      reject(
        new Error("Unable to generate contact sheet. Install FFmpeg or omit --contact-sheet", {
          cause: error,
        }),
      );
    });
    child.once("exit", (code) => {
      if (code === 0) resolveRun();
      else
        reject(new Error(`FFmpeg contact sheet failed with code ${code}: ${errors.slice(-2_000)}`));
    });
  });
}

export async function inspectVideoCommand(
  pathArgument: string,
  arguments_: ParsedArguments,
): Promise<void> {
  const path = resolve(workingDirectory, pathArgument);
  const metadata = await probeVideo(path);
  console.log(JSON.stringify(metadata, null, 2));

  if (arguments_.options.has("contact-sheet")) {
    const configured = stringOption(arguments_, "contact-sheet");
    const filename = `${basename(path, extname(path))}.contact-sheet.png`;
    const outputPath = configured
      ? resolve(workingDirectory, configured)
      : join(dirname(path), filename);
    await mkdir(dirname(outputPath), { recursive: true });
    await runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      path,
      "-vf",
      "fps=1,scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2,tile=4x3:padding=4:margin=4",
      "-frames:v",
      "1",
      "-y",
      outputPath,
    ]);
    console.log(`[demo-recorder] Contact sheet saved: ${outputPath}`);
  }
}
