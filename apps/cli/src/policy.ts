import type { Action } from "@noice-tech/demo-recorder-core";
import type { Risk } from "./driver/types.js";

export type Policy = "read-only" | "reversible";

export type ElementFacts = {
  role: string;
  name: string;
  tag: string;
  inputType?: string | null;
  inForm: boolean;
  href?: string | null;
  download: boolean;
  target?: string | null;
};

export type Decision = {
  allowed: boolean;
  risk: Risk;
  reason: string;
};

const destructivePattern =
  /\b(delete|remove|destroy|drop|discard|uninstall|revoke|deactivate|disable|reset|clear all|close account|sign out|log out|cancel)\b/i;
const reversiblePattern =
  /\b(save|create|add|new|edit|update|apply|confirm|continue|next|submit|send|post|upload|import|duplicate|toggle|check|uncheck)\b/i;

function originOf(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

/** Static read of what an element likely does. It is a heuristic, never a guarantee. */
export function classifyRisk(facts: ElementFacts, currentOrigin?: string): Risk {
  if (facts.download) return "destructive";
  if (facts.tag === "button" && facts.inputType === "submit") return "destructive";
  if (facts.tag === "input" && facts.inputType === "submit") return "destructive";
  if (facts.inForm && (facts.tag === "button" || facts.inputType === "submit"))
    return "destructive";

  const hrefOrigin = originOf(facts.href);
  if (facts.href && currentOrigin && hrefOrigin && hrefOrigin !== currentOrigin) {
    return "external-side-effect";
  }
  if (facts.target === "_blank") return "external-side-effect";

  if (facts.name && destructivePattern.test(facts.name)) return "destructive";
  if (facts.tag === "a") return "read-only";
  if (facts.role === "link") return "read-only";
  if (facts.role === "textbox" || facts.role === "searchbox") return "reversible";
  if (facts.role === "checkbox" || facts.role === "radio" || facts.role === "combobox")
    return "reversible";
  if (facts.name && reversiblePattern.test(facts.name)) return "reversible";
  if (!facts.name) return "unknown";
  return "read-only";
}

/**
 * The one policy decision. The runtime boundary, when present, only enforces
 * these agreed effects; it never re-classifies risk.
 */
export function evaluatePolicy(input: {
  action: Action;
  risk: Risk;
  policy: Policy;
  sameOrigin?: boolean;
}): Decision {
  const { action, risk, policy } = input;
  if (risk === "unknown") {
    return { allowed: false, risk, reason: "The target risk is unknown" };
  }
  if (input.sameOrigin === false) {
    return { allowed: false, risk, reason: "Off-origin navigation is blocked" };
  }
  if (action.type === "navigate" && risk !== "read-only" && risk !== "reversible") {
    return { allowed: false, risk, reason: `Navigation classified as ${risk} is blocked` };
  }
  if (risk === "destructive") {
    return { allowed: false, risk, reason: "Destructive controls are blocked" };
  }
  if (risk === "external-side-effect") {
    return { allowed: false, risk, reason: "Effects outside the page are blocked" };
  }
  if (policy === "read-only" && risk !== "read-only") {
    return { allowed: false, risk, reason: `Policy read-only blocks ${risk} controls` };
  }
  return { allowed: true, risk, reason: `Allowed by ${policy} policy` };
}
