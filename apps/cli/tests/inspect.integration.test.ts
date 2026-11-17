import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProcess } from "@noice-tech/demo-recorder-renderer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inspectOptions, runInspect } from "../src/commands/inspect.js";
import { parseArguments } from "../src/support/args.js";

const ffmpeg = process.env.DEMO_RECORDER_FFMPEG ?? "ffmpeg";
// Tiles are 480x270, separated and framed by 4 px, in a 4x3 grid.
const TILE = { width: 480, height: 270, gap: 4, columns: 4 };

let directory: string;

/** Luma at the center of a tile, read back from the rendered sheet. */
async function tileLuma(sheet: string, index: number): Promise<number> {
  const column = index % TILE.columns;
  const row = Math.floor(index / TILE.columns);
  const x = TILE.gap + column * (TILE.width + TILE.gap) + TILE.width / 2;
  const y = TILE.gap + row * (TILE.height + TILE.gap) + TILE.height / 2;
  const { stdout } = await runProcess(ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    sheet,
    "-vf",
    `crop=1:1:${x}:${y},signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`,
    "-f",
    "null",
    "-",
  ]);
  const match = /YAVG=([0-9.]+)/.exec(stdout);
  if (!match?.[1]) throw new Error(`No luma reading in: ${stdout}`);
  return Number(match[1]);
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "demo-recorder-inspect-"));
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("inspect --contact-sheet", () => {
  it("ends the sheet on the video's final frame", async () => {
    // 2 s at 60 FPS: frames 0..118 are black and only frame 119 is white, the
    // way a demo ends on its result.
    const video = join(directory, "final frame.mp4");
    await runProcess(ffmpeg, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=black:s=320x180:r=60:d=2,format=gray,geq=lum='if(eq(N,119),255,0)'",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-y",
      video,
    ]);

    const result = (await runInspect(
      parseArguments([video, "--contact-sheet"], inspectOptions),
    )) as { contactSheet: string; contactSheetTimesMs: number[] };

    expect(await tileLuma(result.contactSheet, 0)).toBeLessThan(40);
    expect(await tileLuma(result.contactSheet, 10)).toBeLessThan(40);
    expect(await tileLuma(result.contactSheet, 11)).toBeGreaterThan(200);
    // The agent maps tiles back to moments in the video.
    expect(result.contactSheetTimesMs).toHaveLength(12);
    expect(result.contactSheetTimesMs[0]).toBe(0);
    expect(result.contactSheetTimesMs.at(-1)).toBe(1_983);
  });
});
