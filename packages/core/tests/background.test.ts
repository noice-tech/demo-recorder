import { describe, expect, it } from "vitest";
import { backgroundOptionsSchema, resolveBackground } from "../src/index.js";

describe("background configuration", () => {
  it("uses tahoe by default and as the deterministic auto fallback", () => {
    const tahoe = resolveBackground({ type: "preset", name: "tahoe" });
    expect(resolveBackground()).toEqual(tahoe);
    expect(resolveBackground({ type: "auto" })).toEqual({ ...tahoe, source: "auto" });
  });

  it("normalizes custom colors and fills omitted gradient positions", () => {
    expect(resolveBackground({ type: "color", color: "#AABBCC" })).toEqual({
      type: "color",
      color: "#aabbcc",
      source: "custom",
    });
    expect(
      resolveBackground({
        type: "gradient",
        stops: [
          { color: "#000000", position: 0.2 },
          { color: "#888888" },
          { color: "#FFFFFF", position: 0.8 },
        ],
      }),
    ).toMatchObject({
      kind: "linear",
      angle: 135,
      stops: [
        { color: "#000000", position: 0.2 },
        { color: "#888888", position: 0.5 },
        { color: "#ffffff", position: 0.8 },
      ],
    });
  });

  it("rejects invalid colors and unordered explicit stops", () => {
    expect(() => backgroundOptionsSchema.parse({ type: "color", color: "red" })).toThrow();
    expect(() =>
      backgroundOptionsSchema.parse({
        type: "gradient",
        stops: [
          { color: "#000000", position: 0.8 },
          { color: "#ffffff", position: 0.2 },
        ],
      }),
    ).toThrow(/ordered/);
  });
});
