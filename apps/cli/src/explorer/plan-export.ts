import {
  parseDemoPlan,
  type DemoAction,
  type DemoPlan,
  type LocatorSpec,
} from "../demo-plan/index.js";
import {
  explorationDraftPlanRequestSchema,
  type ExplorationDraftPlanRequest,
  type ExplorationLaunchConfig,
  type ExplorationLocatorMethod,
  type ExplorationObservation,
  type ExplorationTransition,
  type ExplorationVerificationReport,
} from "./interactive-schema.js";
import { sanitizeExplorationUrl } from "./privacy.js";

function locatorMethod(method: ExplorationLocatorMethod): LocatorSpec["primary"] {
  return { ...method };
}

function replayUrl(value: string, baseUrl: string, includeUrlState: boolean): string {
  const url = new URL(value, baseUrl);
  if ((url.search || url.hash) && !includeUrlState)
    throw new Error(
      `Cannot export URL state from ${url.pathname}; set includeUrlState to true only when its query and fragment are safe to persist`,
    );
  return `${url.pathname || "/"}${includeUrlState ? `${url.search}${url.hash}` : ""}`;
}

function locatorForTransition(
  transition: ExplorationTransition,
  chosen: ExplorationLocatorMethod | undefined,
): LocatorSpec {
  if (!transition.target || !chosen)
    throw new Error(`Verified transition ${transition.id} has no chosen durable locator`);
  const chosenKey = JSON.stringify(chosen);
  const fallbacks = transition.target.candidates
    .filter((candidate) => JSON.stringify(candidate) !== chosenKey)
    .slice(0, 3)
    .map(locatorMethod);
  return {
    primary: locatorMethod(chosen),
    ...(fallbacks.length > 0 ? { fallbacks } : {}),
  };
}

function actionForTransition(
  transition: ExplorationTransition,
  chosen: ExplorationLocatorMethod | undefined,
  baseUrl: string,
  includeUrlState: boolean,
): DemoAction {
  const action = transition.action;
  const purpose = action.reason ?? `Replay verified transition ${transition.id}`;
  if (action.type === "click")
    return { type: "click", locator: locatorForTransition(transition, chosen), purpose };
  if (action.type === "hover")
    return { type: "move", locator: locatorForTransition(transition, chosen), purpose };
  if (action.type === "goto")
    return {
      type: "navigate",
      url: replayUrl(action.url, baseUrl, includeUrlState),
      purpose,
    };
  if (action.type === "scroll")
    return {
      type: "scroll",
      deltaX: action.deltaX,
      deltaY: action.deltaY,
      purpose,
    };
  if (action.type === "wait") return { type: "hold", durationMs: action.durationMs, purpose };
  throw new Error(
    `Verified transition ${transition.id} uses back navigation, which cannot be exported deterministically`,
  );
}

export function exportVerifiedPathToDemoPlan(options: {
  input: ExplorationDraftPlanRequest;
  config: ExplorationLaunchConfig;
  verification: ExplorationVerificationReport;
  transitions: ExplorationTransition[];
  observations: ExplorationObservation[];
}): DemoPlan {
  const input = explorationDraftPlanRequestSchema.parse(options.input);
  if (options.verification.status !== "passed")
    throw new Error(`Verification ${options.verification.id} did not pass`);
  if (options.verification.id !== input.verificationId)
    throw new Error(
      `Verification mismatch: requested ${input.verificationId}, received ${options.verification.id}`,
    );
  const transitions = new Map(options.transitions.map((transition) => [transition.id, transition]));
  const observations = new Map(
    options.observations.map((observation) => [observation.id, observation]),
  );
  const base = new URL(options.config.baseUrl);
  const includeUrlState = input.includeUrlState ?? false;
  const initialUrl = replayUrl(base.href, base.href, includeUrlState);
  const steps: DemoAction[] = [
    {
      type: "navigate",
      url: initialUrl,
      purpose: "Reproduce the verified initial exploration state",
    },
    { type: "hold", durationMs: 800, purpose: "Establish the initial state" },
  ];
  const beats: DemoPlan["presentation"]["beats"] = [];
  let modifiesData = false;
  let previousExpectedUrl = sanitizeExplorationUrl(options.config.baseUrl);

  for (const verificationStep of options.verification.steps) {
    if (verificationStep.status !== "passed")
      throw new Error(`Verification step ${verificationStep.transitionId} did not pass`);
    const transition = transitions.get(verificationStep.transitionId);
    if (!transition)
      throw new Error(`Missing transition ${verificationStep.transitionId} during plan export`);
    const expected = observations.get(verificationStep.expected.observationId);
    if (!expected)
      throw new Error(
        `Missing observation ${verificationStep.expected.observationId} during plan export`,
      );
    modifiesData ||= transition.policy.risk === "reversible";
    steps.push(
      actionForTransition(
        transition,
        verificationStep.candidateUsed,
        options.config.baseUrl,
        includeUrlState,
      ),
    );

    if (expected.url !== previousExpectedUrl) {
      steps.push({
        type: "wait-for-url",
        urlPattern: expected.url,
        purpose: `Verify navigation after ${transition.id}`,
      });
    }
    const addedHeading = transition.diff?.headingsAdded[0];
    if (addedHeading) {
      steps.push({
        type: "assert-visible",
        locator: {
          primary: { by: "role", role: "heading", name: addedHeading, exact: true },
          fallbacks: [{ by: "text", text: addedHeading, exact: true }],
        },
        purpose: `Verify the expected state after ${transition.id}`,
      });
      if (!beats.some((beat) => beat.label === addedHeading))
        beats.push({
          label: addedHeading,
          importance: beats.length === 0 ? "primary" : "secondary",
        });
    }
    if (["click", "goto", "hover"].includes(transition.action.type))
      steps.push({
        type: "hold",
        durationMs: 800,
        purpose: `Present the verified result of ${transition.id}`,
      });
    previousExpectedUrl = expected.url;
  }

  return parseDemoPlan({
    version: 1,
    name: input.name,
    brief: {
      goal: input.goal,
      ...(input.audience ? { audience: input.audience } : {}),
      ...(input.targetDurationMs ? { targetDurationMs: input.targetDurationMs } : {}),
      constraints: {
        submitForms: false,
        modifyData: modifiesData,
        sameOriginOnly: true,
      },
    },
    target: {
      baseUrl: base.origin,
      ...(options.config.repositoryPath ? { repositoryPath: options.config.repositoryPath } : {}),
      ...(options.config.startCommand ? { startCommand: options.config.startCommand } : {}),
      ...(options.config.readinessUrl ? { readinessUrl: options.config.readinessUrl } : {}),
      ...(options.config.authProfile ? { authProfile: options.config.authProfile } : {}),
    },
    capture: { steps },
    presentation: { beats },
  });
}
