import type { Action, ExplorationAction, Target } from "@noice-tech/demo-recorder-core";
import { ActionError } from "../driver/action-error.js";
import type { ResolvedRef, Risk, Session } from "../driver/types.js";
import { classifyRisk, evaluatePolicy, type Policy } from "../policy.js";
import { settleAfterChange } from "../support/settle.js";
import { observe, readObservation, type Observation } from "./observe.js";

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
  blocked: readonly string[];
};

/** The action on exactly the observed element, through Playwright's `aria-ref` engine. */
function exactAction(action: ExplorationAction, ref: string): Action {
  const target: Target = { selector: `aria-ref=${ref}` };
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

function actionRisk(
  action: ExplorationAction,
  element: ResolvedRef | undefined,
  allowedOrigins: readonly string[],
): { risk: Risk; allowedOrigin: boolean } {
  if (action.type === "navigate") {
    const allowed = allowedOrigins.includes(URL.parse(action.url)?.origin ?? "");
    return { risk: allowed ? "read-only" : "external-side-effect", allowedOrigin: allowed };
  }
  if (action.type === "scroll" || action.type === "hold") {
    return { risk: "read-only", allowedOrigin: true };
  }
  if (!element) return { risk: "unknown", allowedOrigin: true };
  const facts = { ...element.facts, role: element.role, name: element.name ?? "" };
  return { risk: classifyRisk(facts, allowedOrigins), allowedOrigin: true };
}

/**
 * The plan target for an element: its role and exact accessible name, narrowed
 * by the nearest named container when the page repeats that control. It is
 * recordable only when it resolves to exactly this one element.
 */
async function durableTarget(
  session: Session,
  element: ResolvedRef,
): Promise<{ target: Target; recordable: boolean }> {
  const target: Target = element.name
    ? { role: element.role, name: element.name }
    : { role: element.role };
  if ((await session.countMatches(target)) === 1) return { target, recordable: true };
  for (const within of element.scopes) {
    const scoped = { ...target, within };
    if ((await session.countMatches(scoped)) === 1) return { target: scoped, recordable: true };
  }
  return { target, recordable: false };
}

/**
 * Exploration runs a ref-based action on exactly the observed element, derives
 * the durable plan target in the same step, and reports whether it uniquely
 * resolves.
 */
export async function act(input: {
  project: string;
  session: Session;
  policy: Policy;
  allowedOrigins: readonly string[];
  lastObservationId: string;
  nextObservationId: string;
  action: ExplorationAction;
  viewport: { width: number; height: number };
}): Promise<ActResult> {
  const { project, session, policy, lastObservationId, action, viewport } = input;
  // Refs are observation-scoped, so only ref-based actions must name the current
  // observation. navigate, scroll, hold, and a page-level press carry no ref.
  const ref = "ref" in action ? action.ref : undefined;
  if (ref !== undefined) {
    const observationId = "observationId" in action ? action.observationId : undefined;
    if (observationId !== lastObservationId) {
      throw new Error(
        `Action observationId must match the current observation (${lastObservationId})`,
      );
    }
  }

  const previous = await readObservation(project, lastObservationId);
  let element: ResolvedRef | undefined;
  if (ref !== undefined) {
    const observed = previous.elements.find((candidate) => candidate.ref === ref);
    if (!observed)
      throw new Error(`Element ${ref} is not part of observation ${lastObservationId}`);
    // Ref numbers belong to the command that observed them. Find the same node in
    // a fresh snapshot by its position, and confirm it is still the same element.
    element = await session.resolveElement(observed.path);
    if (element?.role !== observed.role || element.name !== observed.name) {
      throw new Error(
        `The page changed since ${lastObservationId}; ${ref} is no longer ${observed.role}` +
          `${observed.name ? ` "${observed.name}"` : ""}. Run explore observe and use the new refs.`,
      );
    }
  }

  const { risk, allowedOrigin } = actionRisk(action, element, input.allowedOrigins);
  const planAction: Action = element ? exactAction(action, element.ref) : action;
  const decision = evaluatePolicy({ action: planAction, risk, policy, allowedOrigin });
  if (!decision.allowed) {
    throw new PolicyError(`Blocked ${action.type}: ${decision.reason}`, risk, decision.reason);
  }

  const durable = element ? await durableTarget(session, element) : undefined;
  const scrollBefore = action.type === "scroll" ? await session.scrollPosition() : undefined;
  try {
    await session.perform(planAction);
  } catch (error) {
    // Name the element as the agent saw it, not by its ref selector.
    if (error instanceof ActionError && element) {
      throw error.about(element.name ? `${element.role} "${element.name}"` : element.role);
    }
    throw error;
  }
  if (scrollBefore) {
    // Wheel scrolling finishes asynchronously; observe the page where it lands.
    await settleAfterChange({
      before: scrollBefore,
      read: () => session.scrollPosition(),
      same: (left, right) => left.x === right.x && left.y === right.y,
      wait: (durationMs) => new Promise((done) => setTimeout(done, durationMs)),
    });
  }

  const next = await observe({
    project,
    session,
    viewport,
    id: input.nextObservationId,
  });
  return {
    observation: next,
    recordable: durable?.recordable ?? true,
    target: durable?.target,
    risk,
    reason: decision.reason,
    blocked: session.blocked(),
  };
}
