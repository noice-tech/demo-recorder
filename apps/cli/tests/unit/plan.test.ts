import { describe, expect, it } from "vitest";
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
  it("parses a safe same-origin plan and estimates its duration", () => {
    const plan = parseDemoPlan(basePlan);
    expect(estimatePlanDurationMs(plan)).toBe(2500);
    expect(plan.brief.constraints.submitForms).toBe(false);
  });

  it("rejects cross-origin navigation by default", () => {
    expect(() =>
      parseDemoPlan({
        ...basePlan,
        capture: { steps: [{ type: "navigate", url: "https://other.example/" }] },
      }),
    ).toThrow(/outside/);
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
