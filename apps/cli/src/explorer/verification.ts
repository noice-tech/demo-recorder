import type { Browser, BrowserContext, Locator, Page } from "playwright";
import { resolveUniqueLocator } from "../browser/locator.js";
import { ExplorationArtifactStore, explorationArtifactLimits } from "./artifacts.js";
import {
  attachBlockedInteractionHandlers,
  createGuardedBrowserContext,
  waitForSemanticQuiet,
} from "./browser-runtime.js";
import { explorationSemanticFingerprint } from "./graph.js";
import {
  explorationVerificationReportSchema,
  explorationVerificationRequestSchema,
  type ExplorationLaunchConfig,
  type ExplorationLocatorMethod,
  type ExplorationObservation,
  type ExplorationTransition,
  type ExplorationVerificationReport,
} from "./interactive-schema.js";
import {
  sanitizeExplorationAction,
  sanitizeExplorationError,
  sanitizeExplorationUrl,
} from "./privacy.js";

async function resolveVerifiedTarget(
  page: Page,
  transition: ExplorationTransition,
): Promise<{ locator: Locator; candidate: ExplorationLocatorMethod }> {
  if (!transition.target)
    throw new Error(`Transition ${transition.id} has no durable target recipe`);
  const resolved = await resolveUniqueLocator(page, transition.target.candidates, {
    description: `No unique visible locator candidate resolved for ${transition.id}`,
  });
  return { locator: resolved.locator, candidate: resolved.method };
}

async function executeReplayAction(
  page: Page,
  transition: ExplorationTransition,
  baseUrl: string,
): Promise<ExplorationLocatorMethod | undefined> {
  const action = transition.action;
  if (action.type === "click" || action.type === "hover") {
    const target = await resolveVerifiedTarget(page, transition);
    if (action.type === "click") await target.locator.click({ timeout: 5_000 });
    else await target.locator.hover({ timeout: 5_000 });
    return target.candidate;
  }
  if (action.type === "goto") {
    await page.goto(new URL(action.url, baseUrl).href, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
  } else if (action.type === "back") {
    await page.goBack({ waitUntil: "domcontentloaded", timeout: 30_000 });
  } else if (action.type === "scroll") {
    await page.mouse.wheel(action.deltaX, action.deltaY);
  } else {
    await page.waitForTimeout(action.durationMs);
  }
  return undefined;
}

function validateSelectedPath(
  request: { transitionIds: string[] },
  observations: ExplorationObservation[],
  transitions: ExplorationTransition[],
): ExplorationTransition[] {
  const byId = new Map(transitions.map((transition) => [transition.id, transition]));
  const selected = request.transitionIds.map((id) => {
    const transition = byId.get(id);
    if (!transition) throw new Error(`Unknown transition in verification path: ${id}`);
    if (transition.status !== "succeeded" || !transition.toObservationId || !transition.toStateId)
      throw new Error(`Transition ${id} is not a replayable successful transition`);
    return transition;
  });
  const initial = observations[0];
  if (!initial) throw new Error("Exploration has no initial observation");
  let expectedFromState = initial.stateId;
  for (const transition of selected) {
    if (transition.fromStateId !== expectedFromState)
      throw new Error(
        `Verification path is disconnected at ${transition.id}: expected ${expectedFromState}, received ${transition.fromStateId}`,
      );
    expectedFromState = transition.toStateId!;
  }
  return selected;
}

export async function verifyExplorationPath(options: {
  browser: Browser;
  config: ExplorationLaunchConfig;
  observations: ExplorationObservation[];
  transitions: ExplorationTransition[];
  artifacts: ExplorationArtifactStore;
  sequence: number;
  input: unknown;
}): Promise<ExplorationVerificationReport> {
  const request = explorationVerificationRequestSchema.parse(options.input);
  const id = `verification-${String(options.sequence).padStart(4, "0")}`;
  const directory = `verification/${id}`;
  const reportArtifact = `${directory}/report.json`;
  const traceArtifact = `${directory}/trace.zip`;
  await options.artifacts.initialize([directory]);
  const createdAt = new Date().toISOString();
  const steps: ExplorationVerificationReport["steps"] = [];
  let context: BrowserContext | undefined;
  let failure: string | undefined;
  let traceAvailable = false;

  try {
    const selected = validateSelectedPath(request, options.observations, options.transitions);
    const observationById = new Map(
      options.observations.map((observation) => [observation.id, observation]),
    );
    context = await createGuardedBrowserContext(options.browser, {
      baseUrl: options.config.baseUrl,
      ...(options.config.storageStatePath
        ? { storageStatePath: options.config.storageStatePath }
        : {}),
      ...(options.config.sessionStoragePath
        ? { sessionStoragePath: options.config.sessionStoragePath }
        : {}),
    });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    const page = await context.newPage();
    attachBlockedInteractionHandlers(page);
    await page.goto(options.config.baseUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await waitForSemanticQuiet(page);
    const initial = options.observations[0]!;
    const initialSnapshot = await page.ariaSnapshot({ mode: "ai", depth: 12, timeout: 5_000 });
    const initialFingerprint = explorationSemanticFingerprint(
      new URL(page.url()).pathname,
      initialSnapshot,
    );
    if (initialFingerprint !== initial.semanticFingerprint)
      throw new Error(
        `Fresh context did not reproduce initial state ${initial.stateId}: expected ${initial.semanticFingerprint}, received ${initialFingerprint}`,
      );

    for (let index = 0; index < selected.length; index += 1) {
      const transition = selected[index]!;
      const expected = observationById.get(transition.toObservationId!);
      if (!expected) throw new Error(`Missing expected observation ${transition.toObservationId}`);
      const startedAt = Date.now();
      let candidateUsed: ExplorationLocatorMethod | undefined;
      const screenshot = `${directory}/step-${String(index + 1).padStart(3, "0")}.png`;
      try {
        candidateUsed = await executeReplayAction(page, transition, options.config.baseUrl);
        await waitForSemanticQuiet(page);
        const snapshot = await page.ariaSnapshot({ mode: "ai", depth: 12, timeout: 5_000 });
        const actual = {
          semanticFingerprint: explorationSemanticFingerprint(
            new URL(page.url()).pathname,
            snapshot,
          ),
          url: sanitizeExplorationUrl(page.url()),
        };
        await options.artifacts.writeExternalFile(
          screenshot,
          explorationArtifactLimits.screenshotBytes,
          (path) => page.screenshot({ path, fullPage: false, scale: "css" }).then(() => {}),
        );
        const matches =
          actual.semanticFingerprint === expected.semanticFingerprint &&
          actual.url === expected.url;
        steps.push({
          sequence: index + 1,
          transitionId: transition.id,
          action: sanitizeExplorationAction(transition.action, options.config.baseUrl),
          status: matches ? "passed" : "failed",
          ...(candidateUsed ? { candidateUsed } : {}),
          expected: {
            observationId: expected.id,
            stateId: expected.stateId,
            semanticFingerprint: expected.semanticFingerprint,
            url: expected.url,
          },
          actual,
          durationMs: Date.now() - startedAt,
          screenshot,
          ...(matches
            ? {}
            : {
                error: `Postcondition mismatch for ${transition.id}: expected state ${expected.stateId}`,
              }),
        });
        if (!matches) {
          failure = steps.at(-1)?.error;
          break;
        }
      } catch (error) {
        failure = sanitizeExplorationError(error instanceof Error ? error.message : String(error));
        const actual = await page
          .ariaSnapshot({ mode: "ai", depth: 12, timeout: 5_000 })
          .then((snapshot) => ({
            semanticFingerprint: explorationSemanticFingerprint(
              new URL(page.url()).pathname,
              snapshot,
            ),
            url: sanitizeExplorationUrl(page.url()),
          }))
          .catch(() => undefined);
        const failureScreenshot = await options.artifacts
          .writeExternalFile(screenshot, explorationArtifactLimits.screenshotBytes, (path) =>
            page.screenshot({ path, fullPage: false, scale: "css" }).then(() => {}),
          )
          .then(() => screenshot)
          .catch(() => undefined);
        steps.push({
          sequence: index + 1,
          transitionId: transition.id,
          action: sanitizeExplorationAction(transition.action, options.config.baseUrl),
          status: "failed",
          ...(candidateUsed ? { candidateUsed } : {}),
          expected: {
            observationId: expected.id,
            stateId: expected.stateId,
            semanticFingerprint: expected.semanticFingerprint,
            url: expected.url,
          },
          ...(actual ? { actual } : {}),
          durationMs: Date.now() - startedAt,
          ...(failureScreenshot ? { screenshot: failureScreenshot } : {}),
          error: failure,
        });
        break;
      }
    }
  } catch (error) {
    failure = sanitizeExplorationError(error instanceof Error ? error.message : String(error));
  } finally {
    if (context) {
      traceAvailable = await options.artifacts
        .writeExternalFile(traceArtifact, explorationArtifactLimits.traceBytes, (path) =>
          context!.tracing.stop({ path }),
        )
        .then(() => true)
        .catch(() => false);
      await context.close().catch(() => undefined);
    }
  }

  const report = explorationVerificationReportSchema.parse({
    schemaVersion: 1,
    id,
    createdAt,
    finishedAt: new Date().toISOString(),
    status: failure ? "failed" : "passed",
    ...(failure ? { error: failure } : {}),
    request,
    steps,
    artifacts: {
      report: reportArtifact,
      ...(traceAvailable ? { trace: traceArtifact } : {}),
    },
  });
  await options.artifacts.writeJson(reportArtifact, report);
  return report;
}
