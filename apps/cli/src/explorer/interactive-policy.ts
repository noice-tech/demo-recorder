import {
  destructiveActionPattern,
  externalEffectPattern,
  isFormControl,
  mutationActionPattern,
  presentationalActionPattern,
} from "../browser/action-risk.js";
import type {
  ExploredInteractiveElementV2,
  ExplorationAction,
  ExplorationPolicyName,
  ExplorationTransition,
} from "./interactive-schema.js";

export type ExplorationElementRiskInput = {
  role?: string;
  name: string;
  tagName: string;
  inputType?: string;
  href?: string;
  expanded?: boolean;
  baseOrigin: string;
};

type RiskAssessment = {
  risk: ExploredInteractiveElementV2["risk"];
  reasons: string[];
};

type ElementRiskRule = {
  matches: (element: ExplorationElementRiskInput, description: string) => boolean;
  risk: RiskAssessment["risk"];
  reason: string;
};

function assessment(risk: RiskAssessment["risk"], reason: string): RiskAssessment {
  return { risk, reasons: [reason] };
}

// First match wins. The order keeps explicit danger signals ahead of structural heuristics.
const elementRiskRules: ElementRiskRule[] = [
  {
    matches: (_element, description) => destructiveActionPattern.test(description),
    risk: "destructive",
    reason: "Target text matches a destructive action",
  },
  {
    matches: (_element, description) => externalEffectPattern.test(description),
    risk: "external-side-effect",
    reason: "Target text suggests an external side effect",
  },
  {
    matches: (element) =>
      Boolean(element.href && new URL(element.href).origin !== element.baseOrigin),
    risk: "external-side-effect",
    reason: "Link leaves the allowed origin",
  },
  {
    matches: (element) => Boolean(element.href),
    risk: "read-only",
    reason: "Same-origin link",
  },
  {
    matches: (element) => isFormControl(element.tagName, element.inputType),
    risk: "unknown",
    reason: "Form controls are not safe by default",
  },
  {
    matches: (element, description) =>
      element.role === "tab" ||
      element.expanded !== undefined ||
      presentationalActionPattern.test(description),
    risk: "read-only",
    reason: "Control appears presentational",
  },
  {
    matches: (_element, description) => mutationActionPattern.test(description),
    risk: "reversible",
    reason: "Target text suggests application data may change",
  },
];

export function classifyExplorationElementRisk(
  element: ExplorationElementRiskInput,
): RiskAssessment {
  const description = `${element.role ?? ""} ${element.name}`.trim();
  const rule = elementRiskRules.find((candidate) => candidate.matches(element, description));
  return rule
    ? assessment(rule.risk, rule.reason)
    : assessment("unknown", "Runtime could not establish that this control is read-only");
}

function protocolActionPolicy(
  element?: ExploredInteractiveElementV2,
): ExplorationTransition["policy"] {
  return {
    allowed: true,
    risk: element?.risk ?? "read-only",
    reasons: ["Action is allowed by the bounded exploration protocol"],
  };
}

function navigationPolicy(
  action: Extract<ExplorationAction, { type: "goto" }>,
  baseUrl: string,
): ExplorationTransition["policy"] | undefined {
  let destination: URL;
  try {
    destination = new URL(action.url, baseUrl);
  } catch {
    return { allowed: false, risk: "unknown", reasons: ["Navigation URL is invalid"] };
  }
  if (destination.origin === new URL(baseUrl).origin) return undefined;
  return {
    allowed: false,
    risk: "external-side-effect",
    reasons: ["Navigation leaves the allowed origin"],
  };
}

function clickPolicy(
  element: ExploredInteractiveElementV2 | undefined,
  policyName: ExplorationPolicyName,
): ExplorationTransition["policy"] {
  if (!element)
    return {
      allowed: false,
      risk: "unknown",
      reasons: ["Element reference does not exist in the current observation"],
    };

  const allowed =
    element.risk === "read-only" || (policyName === "reversible" && element.risk === "reversible");
  return {
    allowed,
    risk: element.risk,
    reasons: allowed
      ? element.riskReasons
      : [...element.riskReasons, `Policy ${policyName} does not allow ${element.risk} actions`],
  };
}

export function decideExplorationActionPolicy(
  action: ExplorationAction,
  policyName: ExplorationPolicyName,
  baseUrl: string,
  element?: ExploredInteractiveElementV2,
): ExplorationTransition["policy"] {
  switch (action.type) {
    case "click":
      return clickPolicy(element, policyName);
    case "goto":
      return navigationPolicy(action, baseUrl) ?? protocolActionPolicy();
    case "hover":
    case "back":
    case "scroll":
    case "scroll-until-text":
    case "scroll-until-regex":
    case "wait":
      return protocolActionPolicy(element);
  }
}
