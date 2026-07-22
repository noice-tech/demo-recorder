import { describe, expect, it } from "vitest";
import { recordingManifestSchema } from "../src/index.js";

const valid = {
  version: 1 as const,
  id: "example",
  createdAt: "2026-07-11T10:00:00.000Z",
  durationMs: 1000,
  viewport: { width: 1440, height: 900 },
  video: { path: "browser.webm", width: 1440, height: 900, durationMs: 1000 },
  events: [{ type: "click" as const, timestampMs: 500, x: 20, y: 30, button: "left" as const }],
};

describe("recordingManifestSchema", () => {
  it("accepts a valid v1 manifest", () => {
    expect(recordingManifestSchema.parse(valid)).toEqual(valid);
  });

  it("accepts empty events and events exactly at the duration boundary", () => {
    expect(recordingManifestSchema.safeParse({ ...valid, events: [] }).success).toBe(true);
    expect(
      recordingManifestSchema.safeParse({
        ...valid,
        events: [{ ...valid.events[0], timestampMs: valid.durationMs }],
      }).success,
    ).toBe(true);
  });

  it("rejects events beyond the duration", () => {
    expect(() =>
      recordingManifestSchema.parse({
        ...valid,
        events: [{ ...valid.events[0], timestampMs: 1001 }],
      }),
    ).toThrow();
  });

  it("rejects unordered events", () => {
    expect(
      recordingManifestSchema.safeParse({
        ...valid,
        events: [
          { ...valid.events[0], timestampMs: 600 },
          { ...valid.events[0], timestampMs: 400 },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects non-finite and out-of-viewport interaction coordinates", () => {
    for (const coordinates of [
      { x: Number.NaN, y: 10 },
      { x: -1, y: 10 },
      { x: valid.viewport.width + 1, y: 10 },
      { x: 10, y: valid.viewport.height + 1 },
    ]) {
      expect(
        recordingManifestSchema.safeParse({
          ...valid,
          events: [{ ...valid.events[0], ...coordinates }],
        }).success,
      ).toBe(false);
    }
  });

  it("requires video and recording duration to share the V1 timeline", () => {
    const result = recordingManifestSchema.safeParse({
      ...valid,
      video: { ...valid.video, durationMs: 999 },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["video", "durationMs"]);
    }
  });
});
