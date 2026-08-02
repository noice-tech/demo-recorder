import { describe, expect, it } from "vitest";
import { resolveCanvas } from "../src/index.js";

const source = { width: 1440, height: 900 };

describe("canvas resolution", () => {
  it("keeps the existing render as the default", () => {
    expect(resolveCanvas(undefined, source)).toEqual({
      width: 1920,
      height: 1080,
      padding: 97.2,
      paddingMode: "minimum",
    });
  });

  it("resolves square, portrait, source, and custom ratios", () => {
    expect(resolveCanvas({ aspectRatio: "1:1", padding: 72 }, source)).toEqual({
      width: 1080,
      height: 1080,
      padding: 72,
      paddingMode: "minimum",
    });
    expect(resolveCanvas({ aspectRatio: "9:16" }, source)).toMatchObject({
      width: 1080,
      height: 1920,
    });
    expect(resolveCanvas({ aspectRatio: "source" }, source)).toMatchObject({
      width: 1920,
      height: 1200,
    });
    expect(resolveCanvas({ aspectRatio: "3:2" }, source)).toMatchObject({
      width: 1920,
      height: 1280,
    });
  });

  it("supports explicit dimensions and makes them encoder-safe", () => {
    expect(resolveCanvas({ width: 1601, height: 1001, padding: 0 }, source)).toEqual({
      width: 1602,
      height: 1002,
      padding: 0,
      paddingMode: "minimum",
    });
    expect(() => resolveCanvas({ width: 1600 }, source)).toThrow("specified together");
    expect(() => resolveCanvas({ aspectRatio: "0:1" }, source)).toThrow("positive");
  });
});
