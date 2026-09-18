import { describe, expect, it } from "vitest";
import { planSchema, planStepSchema } from "../src/index.js";

const valid = {
  version: 1 as const,
  name: "signup-flow",
  goal: "Show a new user signing up",
  target: { baseUrl: "https://app.example.com/" },
  viewport: { width: 1440, height: 900 },
  constraints: { submitForms: false, modifyData: false, sameOriginOnly: true },
  steps: [
    {
      type: "click" as const,
      target: { role: "link", name: "Sign up" },
      purpose: "open signup",
      expect: {
        url: "/signup",
        visible: { role: "heading", name: "Create account" },
        timeoutMs: 5000,
      },
    },
    { type: "hold" as const, durationMs: 1200 },
  ],
};

describe("planSchema", () => {
  it("accepts a plan whose steps use durable targets", () => {
    expect(planSchema.parse(valid)).toEqual(valid);
  });

  it("rejects a plan step that carries an observation ref", () => {
    expect(
      planSchema.safeParse({
        ...valid,
        steps: [{ type: "click", observationId: "obs-0001", ref: "e12" }],
      }).success,
    ).toBe(false);
  });

  it("rejects an empty step list", () => {
    expect(planSchema.safeParse({ ...valid, steps: [] }).success).toBe(false);
  });

  it("requires a goal, an entry target, and a viewport", () => {
    const { goal: _goal, ...withoutGoal } = valid;
    expect(planSchema.safeParse(withoutGoal).success).toBe(false);
    expect(planSchema.safeParse({ ...valid, target: {} }).success).toBe(false);
    expect(planSchema.safeParse({ ...valid, viewport: { width: 0, height: 900 } }).success).toBe(
      false,
    );
  });

  it("rejects an unknown step type", () => {
    expect(planSchema.safeParse({ ...valid, steps: [{ type: "assert-visible" }] }).success).toBe(
      false,
    );
  });

  it("requires fill and select steps to carry a value", () => {
    expect(planStepSchema.safeParse({ type: "fill", target: { role: "textbox" } }).success).toBe(
      false,
    );
    expect(
      planStepSchema.safeParse({
        type: "select",
        target: { role: "combobox" },
        value: "pro",
      }).success,
    ).toBe(true);
  });

  it("treats every condition in expect as one AND block", () => {
    const step = planStepSchema.parse({
      type: "click",
      target: { role: "button", name: "Save" },
      expect: { timeoutMs: 2000 },
    });
    expect(step.expect).toEqual({ timeoutMs: 2000 });
  });
});
