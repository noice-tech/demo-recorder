import { describe, expect, it } from "vitest";
import { resolveAnchorMs, stepInteractionPoint, stepTimeMs, type Recording } from "../src/index.js";

const recording: Recording = {
  version: 1,
  id: "anchor-fixture",
  createdAt: "2026-07-11T10:00:00.000Z",
  durationMs: 4000,
  viewport: { width: 1000, height: 500 },
  guarded: true,
  cursor: "synthetic",
  video: { path: "browser.mp4", width: 1000, height: 500 },
  events: [
    { type: "navigation", timestampMs: 100, step: 1, url: "https://example.test/" },
    { type: "cursor-move", timestampMs: 150, step: 1, x: 10, y: 20 },
    { type: "click", timestampMs: 400, step: 1, x: 300, y: 200, button: "left" },
    { type: "scroll", timestampMs: 2500, step: 2, deltaX: 0, deltaY: 300 },
  ],
};

describe("step anchors", () => {
  it("uses the decisive action of a step as its time", () => {
    expect(stepTimeMs(recording, 1)).toBe(400);
    expect(stepTimeMs(recording, 2)).toBe(2500);
  });

  it("prefers a click over cursor movement for the interaction point", () => {
    expect(stepInteractionPoint(recording, 1)).toEqual({ x: 300, y: 200 });
    expect(stepInteractionPoint(recording, 2)).toBeUndefined();
  });

  it("fails clearly when a step has no events", () => {
    expect(() => stepTimeMs(recording, 7)).toThrow("step 7 has no recorded events");
  });
});

describe("resolveAnchorMs", () => {
  it("resolves start and end edges", () => {
    expect(resolveAnchorMs({ anchor: "start" }, recording)).toBe(0);
    expect(resolveAnchorMs({ anchor: "end" }, recording)).toBe(4000);
  });

  it("resolves a step with a signed offset", () => {
    expect(resolveAnchorMs({ step: 2 }, recording)).toBe(2500);
    expect(resolveAnchorMs({ step: 2, offsetMs: -500 }, recording)).toBe(2000);
    expect(resolveAnchorMs({ step: 2, offsetMs: 250 }, recording)).toBe(2750);
  });

  it("refuses to resolve a missing step", () => {
    expect(() => resolveAnchorMs({ step: 42 }, recording)).toThrow("no recorded events");
  });
});
