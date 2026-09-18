import { describe, expect, it } from "vitest";
import { recordingSchema } from "../src/index.js";

const click = {
  type: "click" as const,
  timestampMs: 500,
  step: 1,
  x: 20,
  y: 30,
  button: "left" as const,
};

const valid = {
  version: 1 as const,
  id: "example",
  createdAt: "2026-07-11T10:00:00.000Z",
  durationMs: 1000,
  viewport: { width: 1440, height: 900 },
  guarded: true,
  cursor: "synthetic" as const,
  video: { path: "browser.mp4", width: 1440, height: 900 },
  events: [click],
};

describe("recordingSchema", () => {
  it("accepts a valid recording with a step-tagged click", () => {
    expect(recordingSchema.parse(valid)).toEqual(valid);
  });

  it("accepts every event type and optional steps", () => {
    const result = recordingSchema.safeParse({
      ...valid,
      events: [
        { type: "navigation", timestampMs: 0, url: "https://example.test/" },
        { type: "cursor-move", timestampMs: 10, step: 1, x: 1, y: 2 },
        { type: "click", timestampMs: 20, step: 1, x: 1, y: 2 },
        { type: "key-press", timestampMs: 30, step: 2, keys: ["Meta", "K"] },
        { type: "scroll", timestampMs: 40, step: 3, deltaX: 0, deltaY: 480 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown top-level version", () => {
    expect(recordingSchema.safeParse({ ...valid, version: 2 }).success).toBe(false);
  });

  it("requires guarded and cursor facts", () => {
    const { guarded: _guarded, ...withoutGuarded } = valid;
    expect(recordingSchema.safeParse(withoutGuarded).success).toBe(false);
    const { cursor: _cursor, ...withoutCursor } = valid;
    expect(recordingSchema.safeParse(withoutCursor).success).toBe(false);
  });

  it("ignores unknown event types instead of failing", () => {
    const result = recordingSchema.safeParse({
      ...valid,
      events: [click, { type: "future-event", timestampMs: 600 }],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.events).toHaveLength(1);
  });

  it("rejects malformed or non-canonical keyboard chords", () => {
    for (const keys of [
      ["K", "Meta"],
      ["Meta", "Meta", "K"],
      ["K", "P"],
    ]) {
      expect(
        recordingSchema.safeParse({
          ...valid,
          events: [{ type: "key-press", timestampMs: 500, keys }],
        }).success,
      ).toBe(false);
    }
  });

  it("accepts events exactly at the duration boundary and rejects the next one", () => {
    expect(
      recordingSchema.safeParse({ ...valid, events: [{ ...click, timestampMs: 1000 }] }).success,
    ).toBe(true);
    expect(
      recordingSchema.safeParse({ ...valid, events: [{ ...click, timestampMs: 1001 }] }).success,
    ).toBe(false);
  });

  it("rejects unordered events", () => {
    expect(
      recordingSchema.safeParse({
        ...valid,
        events: [
          { ...click, timestampMs: 600 },
          { ...click, timestampMs: 400 },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects non-finite or out-of-viewport interaction coordinates", () => {
    for (const coordinates of [
      { x: Number.NaN, y: 10 },
      { x: -1, y: 10 },
      { x: valid.viewport.width + 1, y: 10 },
      { x: 10, y: valid.viewport.height + 1 },
    ]) {
      expect(
        recordingSchema.safeParse({ ...valid, events: [{ ...click, ...coordinates }] }).success,
      ).toBe(false);
    }
  });
});
