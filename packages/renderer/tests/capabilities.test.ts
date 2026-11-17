import { describe, expect, it } from "vitest";
import { parseFfmpegEncoders, parseFfmpegFilters } from "../src/index.js";

describe("FFmpeg capability parsers", () => {
  it("extracts filters without treating headings as capabilities", () => {
    const filters = parseFfmpegFilters(
      ` Filters:\n TSC overlay VV->V Overlay video.\n ... ass V->V Render ASS.\n ..C scale V->V Scale video.`,
    );
    expect([...filters]).toEqual(["overlay", "ass", "scale"]);
  });

  it("extracts filters from FFmpeg 8 output with two flag columns", () => {
    // Verbatim excerpt of `ffmpeg -hide_banner -filters` from FFmpeg 8.0.1.
    const output = [
      "Filters:",
      "  T.. = Timeline support",
      "  .S. = Slice threading",
      "  A = Audio input/output",
      "  V = Video input/output",
      "  N = Dynamic number and/or type of input/output",
      "  | = Source or sink filter",
      " TS aap               AA->A      Apply Affine Projection algorithm to first audio stream.",
      " .. abench            A->A       Benchmark part of a filtergraph.",
      " T. alphamerge        VV->V      Copy the luma value of the second input into the alpha channel of the first input.",
      " .. color             |->V       Provide an uniformly colored input.",
    ].join("\n");
    expect([...parseFfmpegFilters(output)]).toEqual(["aap", "abench", "alphamerge", "color"]);
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
