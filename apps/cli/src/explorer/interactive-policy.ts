import type {
  ExploredInteractiveElementV2,
  ExplorationAction,
  ExplorationPolicyName,
  ExplorationTransition,
} from "./interactive-schema.js";

const destructivePattern =
  /\b(delete|remove|erase|destroy|purchase|buy|pay|publish|send|invite|deploy|merge|revoke|reset|cancel subscription|place order|sign out|log out)\b/i;
const mutationPattern =
  /\b(create|add|upload|approve|launch|save|edit|rename|subscribe|follow|submit|sign up|create account|checkout)\b/i;
const externalEffectPattern =
  /\b(oauth|authorize|grant access|download|install|open in|continue to)\b/i;
const presentationalPattern =
  /\b(open|close|view|show|hide|expand|collapse|next|previous|back|menu|tab|details|preview|examples?|features?|templates?)\b/i;

export type ExplorationElementRiskInput = {
  role?: string;
  name: string;
  tagName: string;
  inputType?: string;
  href?: string;
  expanded?: boolean;
  baseOrigin: string;
};

export function classifyExplorationElementRisk(element: ExplorationElementRiskInput): {
  risk: ExploredInteractiveElementV2["risk"];
  reasons: string[];
} {
  const description = `${element.role ?? ""} ${element.name}`.trim();
  if (destructivePattern.test(description))
    return { risk: "destructive", reasons: ["Target text matches a destructive action"] };
  if (externalEffectPattern.test(description))
    return {
      risk: "external-side-effect",
      reasons: ["Target text suggests an external side effect"],
    };
  if (element.href) {
    const destination = new URL(element.href);
    if (destination.origin !== element.baseOrigin)
      return { risk: "external-side-effect", reasons: ["Link leaves the allowed origin"] };
    return { risk: "read-only", reasons: ["Same-origin link"] };
  }
  if (["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) || element.inputType === "submit")
    return { risk: "unknown", reasons: ["Form controls are not safe by default"] };
  if (
    element.role === "tab" ||
    element.expanded !== undefined ||
    presentationalPattern.test(description)
  )
    return { risk: "read-only", reasons: ["Control appears presentational"] };
  if (mutationPattern.test(description))
    return {
      risk: "reversible",
      reasons: ["Target text suggests application data may change"],
    };
  return {
    risk: "unknown",
    reasons: ["Runtime could not establish that this control is read-only"],
  };
}

export function decideExplorationActionPolicy(
  action: ExplorationAction,
  policyName: ExplorationPolicyName,
  baseUrl: string,
  element?: ExploredInteractiveElementV2,
): ExplorationTransition["policy"] {
  if (action.type === "goto") {
    let destination: URL;
    try {
      destination = new URL(action.url, baseUrl);
    } catch {
      return { allowed: false, risk: "unknown", reasons: ["Navigation URL is invalid"] };
    }
    if (destination.origin !== new URL(baseUrl).origin)
      return {
        allowed: false,
        risk: "external-side-effect",
        reasons: ["Navigation leaves the allowed origin"],
      };
  }
  if (action.type !== "click")
    return {
      allowed: true,
      risk: element?.risk ?? "read-only",
      reasons: ["Action is allowed by the bounded exploration protocol"],
    };
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
