import { describe, expect, it } from "vitest";
import { parsePresentation, presentationSchema, resolveBackground } from "../src/index.js";

describe("presentationSchema", () => {
  it("accepts the contract example", () => {
    const example = {
      version: 1 as const,
      canvas: {
        aspectRatio: "16:9",
        padding: 64,
        background: { type: "preset" as const, name: "mist" as const },
      },
      trim: { from: { anchor: "start" as const }, to: { step: 8, offsetMs: 400 } },
      zooms: [
        { step: 3, leadMs: 600, holdMs: 1400, scale: 1.8 },
        { fromStep: 5, toStep: 7, leadMs: 400, holdMs: 600, scale: 1.5 },
      ],
      browserFrame: { theme: "dark" as const },
    };
    expect(parsePresentation(example)).toEqual(example);
  });

  it("accepts a preset name or a #RRGGBB background string", () => {
    expect(
      presentationSchema.safeParse({ version: 1, canvas: { background: "mist" } }).success,
    ).toBe(true);
    expect(
      presentationSchema.safeParse({ version: 1, canvas: { background: "#FF00AA" } }).success,
    ).toBe(true);
    expect(
      presentationSchema.safeParse({ version: 1, canvas: { background: "red" } }).success,
    ).toBe(false);
  });

  it("rejects raw millisecond effects", () => {
    expect(
      presentationSchema.safeParse({
        version: 1,
        zooms: [{ startMs: 100, endMs: 900, scale: 1.5 }],
      }).success,
    ).toBe(false);
    expect(
      presentationSchema.safeParse({ version: 1, trim: { startMs: 0, endMs: 100 } }).success,
    ).toBe(false);
  });

  it("rejects an unknown top-level version and unknown keys", () => {
    expect(presentationSchema.safeParse({ version: 2 }).success).toBe(false);
    expect(presentationSchema.safeParse({ version: 1, extra: true }).success).toBe(false);
  });

  it("resolves the mist preset used in the contract example", () => {
    expect(resolveBackground({ type: "preset", name: "mist" })).toMatchObject({
      type: "gradient",
      angle: 128,
    });
  });
});
