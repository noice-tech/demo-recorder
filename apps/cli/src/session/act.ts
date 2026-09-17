import type { Action, ExplorationAction, Target } from "@noice-tech/demo-recorder-core";
import type { Session } from "../driver/types.js";
import type { Risk } from "../driver/types.js";
import { evaluatePolicy, type Policy } from "../policy.js";
import { observe, readObservation, type Observation, type ObservationElement } from "./observe.js";

export class PolicyError extends Error {
  readonly risk: Risk;
  readonly reason: string;

  constructor(message: string, risk: Risk, reason: string) {
    super(message);
    this.name = "PolicyError";
    this.risk = risk;
    this.reason = reason;
  }
}

export type ActResult = {
  observation: Observation;
  recordable: boolean;
  target: Target | undefined;
  risk: Risk;
  reason: string;
};

function sameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

function exactAction(action: ExplorationAction, selector: string): Action {
  const target: Target = { selector };
  switch (action.type) {
    case "press":
      return { type: "press", key: action.key, target };
    case "fill":
      return { type: "fill", target, value: action.value };
    case "select":
      return { type: "select", target, value: action.value };
    case "click":
      return { type: "click", target };
    default:
      return action;
  }
}

function elementRisk(
  action: ExplorationAction,
  element: ObservationElement | undefined,
  currentUrl: string,
): { risk: Risk; sameOrigin: boolean } {
  if (action.type === "navigate") {
    const same = sameOrigin(action.url, currentUrl);
    return { risk: same ? "read-only" : "external-side-effect", sameOrigin: same };
  }
  if (action.type === "scroll" || action.type === "hold") {
    return { risk: "read-only", sameOrigin: true };
  }
  return { risk: element?.risk ?? "unknown", sameOrigin: true };
}

/**
 * Exploration runs a ref-based action, computes the durable target in the same
 * step, and reports whether that target uniquely resolves.
 */
export async function act(input: {
  project: string;
  session: Session;
  policy: Policy;
  lastObservationId: string;
  nextObservationId: string;
  action: ExplorationAction;
  viewport: { width: number; height: number };
}): Promise<ActResult> {
  const { project, session, policy, lastObservationId, action, viewport } = input;
  if (!("observationId" in action) || action.observationId !== lastObservationId) {
    throw new Error(
      `Action observationId must match the current observation (${lastObservationId})`,
    );
  }

  const previous = await readObservation(project, lastObservationId);
  const element =
    "ref" in action && action.ref
      ? previous.elements.find((candidate) => candidate.ref === action.ref)
      : undefined;
  if ("ref" in action && action.ref && !element) {
    throw new Error(`Element ${action.ref} is not part of observation ${lastObservationId}`);
  }

  const { risk, sameOrigin: same } = elementRisk(action, element, previous.url);
  const planAction: Action = element ? exactAction(action, element.selector) : action;
  const decision = evaluatePolicy({
    action: planAction,
    risk,
    policy,
    sameOrigin: same,
  });
  if (!decision.allowed) {
    throw new PolicyError(`Blocked ${action.type}: ${decision.reason}`, risk, decision.reason);
  }

  const recordable = element ? (await session.countMatches(element.target)) === 1 : true;
  await session.perform(planAction);

  const next = await observe({
    project,
    session,
    viewport,
    id: input.nextObservationId,
  });
  return {
    observation: next,
    recordable,
    target: element?.target,
    risk,
    reason: decision.reason,
  };
}
