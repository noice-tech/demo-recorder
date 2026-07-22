import { describe, expect, it } from "vitest";
import { containRect, projectViewportPoint } from "../src/index.js";

describe("containRect", () => {
  it("fits a landscape viewport with vertical letterboxing", () => {
    expect(
      containRect({ width: 1440, height: 900 }, { x: 100, y: 50, width: 1600, height: 1000 }),
    ).toEqual({ x: 100, y: 50, width: 1600, height: 1000 });

    const letterboxed = containRect(
      { width: 1920, height: 1080 },
      { x: 10, y: 20, width: 1000, height: 1000 },
    );
    expect(letterboxed.x).toBeCloseTo(10);
    expect(letterboxed.y).toBeCloseTo(238.75);
    expect(letterboxed.width).toBeCloseTo(1000);
    expect(letterboxed.height).toBeCloseTo(562.5);
  });

  it("fits a portrait source with horizontal letterboxing", () => {
    expect(
      containRect({ width: 900, height: 1440 }, { x: 0, y: 0, width: 1000, height: 500 }),
    ).toEqual({ x: 343.75, y: 0, width: 312.5, height: 500 });
  });

  it("rejects nonpositive dimensions", () => {
    expect(() =>
      containRect({ width: 0, height: 900 }, { x: 0, y: 0, width: 100, height: 100 }),
    ).toThrow("positive");
  });
});

describe("projectViewportPoint", () => {
  const viewport = { width: 1000, height: 500 };
  const rect = { x: 100, y: 200, width: 800, height: 400 };

  it("projects points with content scale and offset", () => {
    expect(projectViewportPoint({ x: 500, y: 250 }, viewport, rect)).toEqual({ x: 500, y: 400 });
  });

  it("clamps points to content edges", () => {
    expect(projectViewportPoint({ x: -50, y: 700 }, viewport, rect)).toEqual({ x: 100, y: 600 });
  });
});
