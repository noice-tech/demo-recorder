import { describe, expect, it } from "vitest";
import { parseFfmpegEncoders, parseFfmpegFilters } from "../src/index.js";

describe("FFmpeg capability parsers", () => {
  it("extracts filters without treating headings as capabilities", () => {
    const filters = parseFfmpegFilters(
      ` Filters:\n TSC overlay VV->V Overlay video.\n ... ass V->V Render ASS.\n ..C scale V->V Scale video.`,
    );
    expect([...filters]).toEqual(["overlay", "ass", "scale"]);
  });

  it("extracts software and hardware encoders", () => {
    const encoders = parseFfmpegEncoders(
      ` V....D libx264 H.264\n V....D h264_videotoolbox VideoToolbox\n A....D aac AAC`,
    );
    expect(encoders.has("libx264")).toBe(true);
    expect(encoders.has("h264_videotoolbox")).toBe(true);
    expect(encoders.has("aac")).toBe(true);
  });
});
