import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  rehearsalFingerprint,
  rehearsalReceiptPath,
  requireRehearsalReceipt,
  saveRehearsalReceipt,
} from "../../src/rehearsal-receipt.js";
import { estimatePlanDurationMs, parseDemoPlan } from "../../src/demo-plan/index.js";

const basePlan = {
  version: 1,
  name: "tour",
  brief: { goal: "Show the main pages" },
  target: { baseUrl: "https://example.com" },
  capture: {
    steps: [
      { type: "navigate", url: "/" },
      { type: "hold", durationMs: 1000 },
    ],
  },
};

describe("demo plan", () => {
  it("requires matching rehearsal readiness but allows presentation-only changes", async () => {
    const path = `receipt-test-${randomUUID()}.json`;
    const plan = parseDemoPlan(basePlan);
    try {
      await expect(requireRehearsalReceipt(path, plan, true)).rejects.toThrow("Missing or stale");
      await saveRehearsalReceipt(path, rehearsalFingerprint(plan, true), "report.json");
      await expect(requireRehearsalReceipt(path, plan, true)).resolves.toBeUndefined();
      await expect(requireRehearsalReceipt(path, plan, false)).rejects.toThrow("stale");
      const changed = parseDemoPlan({ ...basePlan, target: { baseUrl: "https://other.example" } });
      await expect(requireRehearsalReceipt(path, changed, true)).rejects.toThrow("stale");
      const restyled = parseDemoPlan({
        ...basePlan,
        presentation: { canvas: { aspectRatio: "1:1" } },
      });
      await expect(requireRehearsalReceipt(path, restyled, true)).resolves.toBeUndefined();
    } finally {
      await rm(rehearsalReceiptPath(path), { force: true });
    }
  });

  it("parses a safe same-origin plan and estimates its duration", () => {
    const plan = parseDemoPlan(basePlan);
    expect(estimatePlanDurationMs(plan)).toBe(2500);
    expect(plan.brief.constraints.submitForms).toBe(false);
  });

  it("accepts independent capture viewport and presentation canvas settings", () => {
    const plan = parseDemoPlan({
      ...basePlan,
      capture: { ...basePlan.capture, viewport: { width: 1280, height: 720 } },
      presentation: {
        beats: [],
        canvas: {
          aspectRatio: "1:1",
          padding: 72,
          background: { type: "preset", name: "prism" },
        },
        browserFrame: { theme: "light" },
      },
    });
    expect(plan.capture.viewport).toEqual({ width: 1280, height: 720 });
    expect(plan.presentation.canvas).toEqual({
      aspectRatio: "1:1",
      padding: 72,
      background: { type: "preset", name: "prism" },
    });
    expect(plan.presentation.browserFrame).toEqual({ theme: "light" });
  });

  it("rejects invalid or conflicting canvas dimensions", () => {
    expect(() =>
      parseDemoPlan({
        ...basePlan,
        presentation: { beats: [], canvas: { aspectRatio: "0:1" } },
      }),
    ).toThrow(/positive/);
    expect(() =>
      parseDemoPlan({
        ...basePlan,
        presentation: { beats: [], canvas: { width: 1080 } },
      }),
    ).toThrow(/specified together/);
  });

  it("rejects cross-origin navigation by default", () => {
    expect(() =>
      parseDemoPlan({
        ...basePlan,
        capture: { steps: [{ type: "navigate", url: "https://other.example/" }] },
      }),
    ).toThrow(/outside/);
  });

  it("rejects invisible mid-story route changes", () => {
    expect(() =>
      parseDemoPlan({
        ...basePlan,
        capture: {
          steps: [
            { type: "navigate", url: "/" },
            { type: "hold", durationMs: 800 },
            { type: "navigate", url: "/pricing" },
          ],
        },
      }),
    ).toThrow(/must click a visible link or button/);
  });

  it("allows conservative global keyboard shortcuts in a read-only plan", () => {
    const plan = parseDemoPlan({
      ...basePlan,
      capture: {
        steps: [
          { type: "navigate", url: "/" },
          { type: "press", key: "ControlOrMeta+K" },
          { type: "press", key: "Escape" },
        ],
      },
    });
    expect(plan.capture.steps[1]).toMatchObject({ type: "press", key: "ControlOrMeta+K" });
  });

  it("rejects mutating keyboard actions in a read-only plan", () => {
    expect(() =>
      parseDemoPlan({
        ...basePlan,
        capture: { steps: [{ type: "press", key: "Enter" }] },
      }),
    ).toThrow(/potentially mutating/);
  });

  it("rejects likely mutations in a read-only plan", () => {
    expect(() =>
      parseDemoPlan({
        ...basePlan,
        capture: {
          steps: [
            {
              type: "click",
              locator: { primary: { by: "role", role: "button", name: "Create project" } },
            },
          ],
        },
      }),
    ).toThrow(/modify data/);
  });

  it("rejects an inverted presentation trim", () => {
    expect(() =>
      parseDemoPlan({
        ...basePlan,
        presentation: { beats: [], trimStartMs: 900, trimEndMs: 100 },
      }),
    ).toThrow(/trim end/);
  });

  it("rejects destructive clicks", () => {
    expect(() =>
      parseDemoPlan({
        ...basePlan,
        capture: {
          steps: [
            {
              type: "click",
              locator: { primary: { by: "role", role: "button", name: "Delete account" } },
            },
          ],
        },
      }),
    ).toThrow(/destructive/);
  });
});
