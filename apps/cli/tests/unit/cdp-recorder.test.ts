import { describe, expect, it } from "vitest";
import { recordingFps, targetFrameCount } from "../../src/capture/cdp-recorder.js";

describe("CDP recorder frame scheduling", () => {
  it("starts with one frame and advances on absolute 60 FPS boundaries", () => {
    expect(recordingFps).toBe(60);
    expect(targetFrameCount(0)).toBe(1);
    expect(targetFrameCount(16)).toBe(1);
    expect(targetFrameCount(1_000 / 60)).toBe(1);
    expect(targetFrameCount(17)).toBe(2);
    expect(targetFrameCount(1_000)).toBe(60);
  });

  it("catches up from elapsed time instead of accumulating timer drift", () => {
    expect(targetFrameCount(100)).toBe(6);
    expect(targetFrameCount(250)).toBe(15);
    expect(targetFrameCount(2_500)).toBe(150);
  });

  it("rejects invalid timing inputs", () => {
    expect(() => targetFrameCount(-1)).toThrow("Elapsed time");
    expect(() => targetFrameCount(Number.NaN)).toThrow("Elapsed time");
    expect(() => targetFrameCount(1, 0)).toThrow("Recording FPS");
  });
});
