import { describe, expect, it } from "vitest";
import type { ExploredInteractiveElementV2 } from "../../src/explorer/interactive-schema.js";
import {
  classifyExplorationElementRisk,
  decideExplorationActionPolicy,
} from "../../src/explorer/interactive-policy.js";

function element(risk: ExploredInteractiveElementV2["risk"]): ExploredInteractiveElementV2 {
  return {
    ref: "e1",
    role: "button",
    name: "Control",
    tagName: "BUTTON",
    visible: true,
    enabled: true,
    bounds: { x: 0, y: 0, width: 100, height: 40 },
    risk,
    riskReasons: [`Classified as ${risk}`],
    target: {
      description: "button Control",
      candidates: [{ by: "role", role: "button", name: "Control", exact: true }],
      expected: { role: "button", accessibleName: "Control", count: 1 },
    },
  };
}

describe("exploration risk classification", () => {
  const baseOrigin = "https://example.com";

  it.each([
    ["Delete project", "BUTTON", undefined, "destructive"],
    ["Create project", "BUTTON", undefined, "reversible"],
    ["Open details", "BUTTON", undefined, "read-only"],
    ["Email", "INPUT", "email", "unknown"],
    ["Save workspace", "BUTTON", "submit", "unknown"],
  ] as const)("classifies %s as %s", (name, tagName, inputType, expected) => {
    expect(
      classifyExplorationElementRisk({
        name,
        tagName,
        ...(inputType ? { inputType } : {}),
        baseOrigin,
      }).risk,
    ).toBe(expected);
  });

  it("distinguishes same-origin and external links", () => {
    expect(
      classifyExplorationElementRisk({
        name: "Documentation",
        tagName: "A",
        href: "https://example.com/docs",
        baseOrigin,
      }).risk,
    ).toBe("read-only");
    expect(
      classifyExplorationElementRisk({
        name: "Documentation",
        tagName: "A",
        href: "https://outside.test/docs",
        baseOrigin,
      }).risk,
    ).toBe("external-side-effect");
  });
});

describe("exploration action policy", () => {
  const baseUrl = "https://example.com/start";
  const click = { type: "click", observationId: "obs-1", ref: "e1" } as const;

  it("allows read-only clicks and requires reversible policy for mutation-like clicks", () => {
    expect(
      decideExplorationActionPolicy(click, "read-only", baseUrl, element("read-only")).allowed,
    ).toBe(true);
    expect(
      decideExplorationActionPolicy(click, "read-only", baseUrl, element("reversible")).allowed,
    ).toBe(false);
    expect(
      decideExplorationActionPolicy(click, "reversible", baseUrl, element("reversible")).allowed,
    ).toBe(true);
  });

  it("never allows destructive or external-side-effect clicks", () => {
    expect(
      decideExplorationActionPolicy(click, "reversible", baseUrl, element("destructive")).allowed,
    ).toBe(false);
    expect(
      decideExplorationActionPolicy(click, "reversible", baseUrl, element("external-side-effect"))
        .allowed,
    ).toBe(false);
  });

  it("allows only same-origin goto actions", () => {
    expect(
      decideExplorationActionPolicy({ type: "goto", url: "/docs" }, "read-only", baseUrl).allowed,
    ).toBe(true);
    expect(
      decideExplorationActionPolicy(
        { type: "goto", url: "https://outside.test" },
        "read-only",
        baseUrl,
      ),
    ).toMatchObject({ allowed: false, risk: "external-side-effect" });
    expect(
      decideExplorationActionPolicy({ type: "goto", url: "http://[" }, "read-only", baseUrl),
    ).toMatchObject({ allowed: false, risk: "unknown" });
  });
});
