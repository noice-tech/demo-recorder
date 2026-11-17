import { describe, expect, it } from "vitest";
import { contactSheetSamples } from "../../src/commands/inspect.js";

const frames = (durationMs: number) =>
  contactSheetSamples(durationMs, 60).map((sample) => sample.frame);

// inspect.integration.test.ts proves the rendered sheet ends on the final frame;
// these cover the frame-count edge cases that would need many fixture videos.
describe("contact sheet sampling", () => {
  it.each([
    { case: "a recorded clip", durationMs: 8_633.333, first: 0, last: 517 },
    { case: "a duration ffprobe rounded up", durationMs: 1_000.0004, first: 0, last: 59 },
    { case: "a duration ffprobe rounded down", durationMs: 999.9996, first: 0, last: 59 },
  ])("spans $case from its first to its last frame", ({ durationMs, first, last }) => {
    const sampled = frames(durationMs);
    expect(sampled).toHaveLength(12);
    expect(sampled[0]).toBe(first);
    expect(sampled.at(-1)).toBe(last);
  });

  it("uses each frame once when the video is shorter than the sheet", () => {
    expect(frames(100)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(frames(16.67)).toEqual([0]);
  });

  it("rejects metadata it cannot sample", () => {
    expect(() => contactSheetSamples(0, 60)).toThrow(/duration/);
    expect(() => contactSheetSamples(1_000, 0)).toThrow(/frame rate/);
  });
});
