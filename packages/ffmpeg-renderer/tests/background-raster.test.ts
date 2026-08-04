import { resolveBackground } from "@noice-tech/demo-recorder-core";
import { describe, expect, it } from "vitest";
import { generateBackgroundRaster } from "../src/index.js";

function pixels(buffer: Buffer): number[] {
  const headerEnd = buffer.indexOf("\n255\n") + 5;
  return [...buffer.subarray(headerEnd)];
}

describe("background raster", () => {
  it("generates a binary PPM solid color", () => {
    const raster = generateBackgroundRaster(
      2,
      1,
      resolveBackground({ type: "color", color: "#123456" }),
    );
    expect(raster.subarray(0, 11).toString("ascii")).toBe("P6\n2 1\n255\n");
    expect(pixels(raster)).toEqual([0x12, 0x34, 0x56, 0x12, 0x34, 0x56]);
  });

  it("interpolates linear gradients across the requested dimensions", () => {
    const raster = generateBackgroundRaster(
      3,
      1,
      resolveBackground({
        type: "gradient",
        angle: 90,
        stops: [{ color: "#000000" }, { color: "#ffffff" }],
      }),
    );
    const values = pixels(raster);
    expect(values[0]).toBeLessThan(values[3]!);
    expect(values[3]).toBeLessThan(values[6]!);
  });
});
