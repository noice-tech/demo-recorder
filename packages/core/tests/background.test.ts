import { describe, expect, it } from "vitest";
import { backgroundOptionsSchema, resolveBackground } from "../src/index.js";

describe("background configuration", () => {
  it("uses tahoe by default", () => {
    expect(resolveBackground()).toEqual(resolveBackground({ type: "preset", name: "tahoe" }));
  });

  it("normalizes colors and evenly positions custom gradients", () => {
    expect(resolveBackground({ type: "color", color: "#AABBCC" })).toEqual({
      type: "color",
      color: "#aabbcc",
    });
    expect(
      resolveBackground({
        type: "gradient",
        colors: ["#000000", "#888888", "#FFFFFF"],
      }),
    ).toMatchObject({
      angle: 135,
      stops: [
        { color: "#000000", position: 0 },
        { color: "#888888", position: 0.5 },
        { color: "#ffffff", position: 1 },
      ],
    });
  });

  it("rejects invalid colors", () => {
    expect(() => backgroundOptionsSchema.parse({ type: "color", color: "red" })).toThrow();
    expect(() =>
      backgroundOptionsSchema.parse({ type: "gradient", colors: ["#000000", "white"] }),
    ).toThrow();
  });
});
