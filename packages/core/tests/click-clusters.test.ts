import { describe, expect, it } from "vitest";
import { clusterClicks, type RecordingEvent } from "../src/index.js";

const click = (timestampMs: number, x: number, y: number): RecordingEvent => ({
  type: "click",
  timestampMs,
  x,
  y,
  button: "left",
});

const config = { clickClusterRadiusPx: 100, clickClusterWindowMs: 1000 };

describe("clusterClicks", () => {
  it("returns no clusters when there are no clicks", () => {
    expect(clusterClicks([], config)).toEqual([]);
  });

  it("groups nearby clicks and separates distant clicks", () => {
    const clusters = clusterClicks(
      [click(100, 10, 10), click(300, 20, 20), click(500, 800, 600)],
      config,
    );
    expect(clusters).toHaveLength(2);
    expect(clusters[0]?.clicks).toHaveLength(2);
    expect(clusters[0]?.centerX).toBe(15);
  });

  it("includes a click exactly at the time and radius boundaries", () => {
    const clusters = clusterClicks([click(0, 0, 0), click(1000, 200, 0)], config);
    expect(clusters).toHaveLength(1);
  });

  it("starts a new cluster beyond the time window", () => {
    expect(clusterClicks([click(0, 10, 10), click(1001, 10, 10)], config)).toHaveLength(2);
  });

  it("checks every click against the candidate center to prevent spatial chaining", () => {
    const clusters = clusterClicks(
      [click(0, 0, 0), click(100, 100, 0), click(200, 200, 0), click(300, 300, 0)],
      config,
    );
    expect(clusters).toHaveLength(2);
    expect(clusters[0]?.clicks).toHaveLength(3);
    expect(clusters[1]?.clicks).toHaveLength(1);
  });
});
