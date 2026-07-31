import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import {
  generateScrollGesture,
  scrollDurationMs,
  smoothScroll,
} from "../../src/browser/smooth-scroll.js";

describe("generateScrollGesture", () => {
  it("preserves the requested distance across 60 FPS wheel samples", () => {
    const gesture = generateScrollGesture(3_000, -300);
    expect(gesture.durationMs).toBeGreaterThan(1_000);
    expect(gesture.durationMs).toBeLessThan(1_200);
    expect(gesture.deltas.length).toBeGreaterThan(50);
    expect(gesture.deltas.length).toBeLessThan(80);
    expect(gesture.deltas.reduce((sum, delta) => sum + delta.deltaX, 0)).toBeCloseTo(-300, 10);
    expect(gesture.deltas.reduce((sum, delta) => sum + delta.deltaY, 0)).toBeCloseTo(3_000, 10);
  });

  it("accelerates briefly and has a longer momentum decay", () => {
    const deltas = generateScrollGesture(1_000).deltas.map((delta) => delta.deltaY);
    const peak = Math.max(...deltas);
    const peakIndex = deltas.indexOf(peak);
    expect(peakIndex).toBeGreaterThan(0);
    expect(peakIndex).toBeLessThan(deltas.length / 3);
    expect(deltas.at(-1)).toBeLessThan(peak / 8);
    expect(deltas.every((delta) => delta > 0)).toBe(true);
  });

  it("handles reverse scrolling, zero movement, and explicit durations", () => {
    const reverse = generateScrollGesture(-500, 0, { durationMs: 400 });
    expect(reverse.durationMs).toBe(400);
    expect(reverse.deltas.length).toBeGreaterThan(0);
    expect(reverse.deltas.every((delta) => delta.deltaY < 0)).toBe(true);
    expect(generateScrollGesture(0)).toEqual({ deltas: [], durationMs: 0 });
  });

  it("scales and bounds inferred duration", () => {
    expect(scrollDurationMs(1)).toBe(320);
    expect(scrollDurationMs(1_000)).toBe(570);
    expect(scrollDurationMs(100_000)).toBe(3_000);
    expect(() => generateScrollGesture(Number.NaN)).toThrow(/finite/);
    expect(() => generateScrollGesture(100, 0, { durationMs: 0 })).toThrow(/duration/);
  });
});

describe("smoothScroll", () => {
  it("uses absolute scheduling and leaves a frame for the final wheel event", async () => {
    let clockMs = 0;
    const calls: Array<{ deltaX: number; deltaY: number; atMs: number }> = [];
    const page = {
      mouse: {
        wheel: (deltaX: number, deltaY: number) => {
          calls.push({ deltaX, deltaY, atMs: clockMs });
          return Promise.resolve();
        },
      },
      waitForTimeout: (durationMs: number) => {
        clockMs += durationMs;
        return Promise.resolve();
      },
    } as unknown as Page;

    await smoothScroll(page, 600, 60, { durationMs: 400, now: () => clockMs });

    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]?.atMs).toBe(0);
    expect(calls.at(-1)?.atMs).toBeCloseTo(400, 10);
    expect(calls.reduce((sum, call) => sum + call.deltaX, 0)).toBeCloseTo(60, 10);
    expect(calls.reduce((sum, call) => sum + call.deltaY, 0)).toBeCloseTo(600, 10);
    expect(clockMs).toBeGreaterThan(400);
  });
});
