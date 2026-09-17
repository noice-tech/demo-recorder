import { describe, expect, it } from "vitest";
import { classifyRisk, evaluatePolicy, type ElementFacts } from "../../src/policy.js";

const link = (overrides: Partial<ElementFacts> = {}): ElementFacts => ({
  role: "link",
  name: "Docs",
  tag: "a",
  inForm: false,
  download: false,
  ...overrides,
});

describe("classifyRisk", () => {
  it("treats same-origin links as read-only", () => {
    expect(classifyRisk(link({ href: "https://app.test/docs" }), "https://app.test")).toBe(
      "read-only",
    );
  });

  it("treats off-origin and new-tab links as external side effects", () => {
    expect(classifyRisk(link({ href: "https://other.test/" }), "https://app.test")).toBe(
      "external-side-effect",
    );
    expect(classifyRisk(link({ target: "_blank" }), "https://app.test")).toBe(
      "external-side-effect",
    );
  });

  it("treats downloads and form submits as destructive", () => {
    expect(classifyRisk(link({ download: true }), "https://app.test")).toBe("destructive");
    expect(
      classifyRisk(
        {
          role: "button",
          name: "Send",
          tag: "button",
          inputType: "submit",
          inForm: true,
          download: false,
        },
        "https://app.test",
      ),
    ).toBe("destructive");
  });

  it("classifies text fields as reversible and destructive verbs as destructive", () => {
    expect(
      classifyRisk(
        { role: "textbox", name: "Email", tag: "input", inForm: true, download: false },
        "https://app.test",
      ),
    ).toBe("reversible");
    expect(
      classifyRisk(
        { role: "button", name: "Delete account", tag: "button", inForm: false, download: false },
        "https://app.test",
      ),
    ).toBe("destructive");
    expect(
      classifyRisk(
        { role: "button", name: "Save changes", tag: "button", inForm: false, download: false },
        "https://app.test",
      ),
    ).toBe("reversible");
  });

  it("flags unnamed controls as unknown risk", () => {
    expect(
      classifyRisk(
        { role: "button", name: "", tag: "button", inForm: false, download: false },
        "https://app.test",
      ),
    ).toBe("unknown");
  });
});

describe("evaluatePolicy", () => {
  const click = { type: "click" as const, target: { role: "button", name: "Save" } };

  it("allows read-only actions under the default policy", () => {
    expect(evaluatePolicy({ action: click, risk: "read-only", policy: "read-only" }).allowed).toBe(
      true,
    );
  });

  it("blocks mutating actions under read-only and allows them under reversible", () => {
    expect(evaluatePolicy({ action: click, risk: "reversible", policy: "read-only" }).allowed).toBe(
      false,
    );
    expect(
      evaluatePolicy({ action: click, risk: "reversible", policy: "reversible" }).allowed,
    ).toBe(true);
  });

  it("always blocks destructive, external, and unknown risk", () => {
    for (const risk of ["destructive", "external-side-effect", "unknown"] as const) {
      expect(evaluatePolicy({ action: click, risk, policy: "reversible" }).allowed).toBe(false);
    }
  });

  it("blocks off-origin navigation with a reason", () => {
    const decision = evaluatePolicy({
      action: { type: "navigate", url: "https://other.test/" },
      risk: "read-only",
      policy: "reversible",
      sameOrigin: false,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("Off-origin");
  });
});
