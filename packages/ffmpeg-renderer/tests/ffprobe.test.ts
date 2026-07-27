import { describe, expect, it } from "vitest";
import { parseFfprobeOutput } from "../src/index.js";

describe("parseFfprobeOutput", () => {
  it("normalizes video metadata and detects audio", () => {
    expect(
      parseFfprobeOutput({
        streams: [
          {
            codec_type: "video",
            codec_name: "vp8",
            width: 1440,
            height: 900,
            avg_frame_rate: "25/1",
            pix_fmt: "yuv420p",
          },
          { codec_type: "audio", codec_name: "opus", sample_rate: "48000", channels: 2 },
        ],
        format: { duration: "2.500" },
      }),
    ).toEqual({
      width: 1440,
      height: 900,
      durationMs: 2500,
      fps: 25,
      codec: "vp8",
      pixelFormat: "yuv420p",
      hasAudio: true,
    });
  });

  it("rejects input without a video stream", () => {
    expect(() => parseFfprobeOutput({ streams: [], format: { duration: "1" } })).toThrow(
      "no video stream",
    );
  });
});
