import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { resolveVisibleClickTarget } from "./browser/locator.js";
import { smoothScroll } from "./browser/smooth-scroll.js";
import { resolvePlanLocator } from "./capture/plan.js";
import { loadDemoPlan, type DemoAction, type DemoPlan } from "./demo-plan/index.js";
import { ExplorationArtifactStore, explorationArtifactLimits } from "./explorer/artifacts.js";
import {
  attachBlockedInteractionHandlers,
  createGuardedBrowserContext,
} from "./explorer/browser-runtime.js";
import { authProfilePaths } from "./explorer/auth.js";
import { startManagedApp } from "./explorer/managed-app.js";
import { sanitizeExplorationError, sanitizeExplorationUrl } from "./explorer/privacy.js";
import { workingDirectory } from "./paths.js";

export type RehearsalStepResult = {
  index: number;
  type: DemoAction["type"];
  purpose?: string;
  status: "passed" | "failed";
  durationMs: number;
  error?: string;
};

export type RehearsalReport = {
  version: 1;
  id: string;
  planName: string;
  planPath: string;
  attempt: number;
  maxAttempts: 3;
  mode: "fast" | "full";
  status: "passed" | "failed";
  createdAt: string;
  finishedAt: string;
  steps: RehearsalStepResult[];
  failure?: {
    stepIndex: number;
    url: string;
    title: string;
    error: string;
    repairHints: string[];
  };
  artifacts: {
    report: string;
    trace?: string;
    failureSnapshot?: string;
    failureScreenshot?: string;
    finalScreenshot?: string;
  };
};

const fastHoldLimitMs = 100;
const fastScrollDurationMs = 150;

export function rehearsalHoldDuration(durationMs: number, fast: boolean): number {
  return fast ? Math.min(durationMs, fastHoldLimitMs) : durationMs;
}

async function executeRehearsalAction(
  plan: DemoPlan,
  page: Page,
  step: DemoAction,
  fast: boolean,
): Promise<void> {
  switch (step.type) {
    case "navigate":
      await page.goto(new URL(step.url, plan.target.baseUrl).href, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      return;
    case "scroll":
      await smoothScroll(
        page,
        step.deltaY,
        step.deltaX ?? 0,
        fast ? { durationMs: fastScrollDurationMs } : {},
      );
      return;
    case "hold":
      await page.waitForTimeout(rehearsalHoldDuration(step.durationMs, fast));
      return;
    case "wait-for-url":
      await page.waitForURL(step.urlPattern, step.timeoutMs ? { timeout: step.timeoutMs } : {});
      return;
  }

  const locator = await resolvePlanLocator(page, step.locator);
  switch (step.type) {
    case "move": {
      const bounds = await locator.boundingBox();
      if (!bounds) throw new Error("Move target has no visible bounding box");
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return;
    }
    case "click": {
      const clickTarget = await resolveVisibleClickTarget(page, locator);
      await clickTarget.click({ button: step.button ?? "left" });
      return;
    }
    case "fill":
      await locator.fill(step.value);
      return;
    case "press":
      await locator.press(step.key);
      return;
    case "select":
      await locator.selectOption(step.value);
      return;
    case "wait-for":
      await locator.waitFor({
        state: "visible",
        ...(step.timeoutMs ? { timeout: step.timeoutMs } : {}),
      });
  }
}

function errorWithCauses(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const messages: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  return messages.join("; caused by: ");
}

const repairHintRules = [
  {
    pattern: /matched \d+ elements|expected exactly one|unique plan locator/i,
    hints: [
      "Refine the primary locator or add a unique test-ID/CSS fallback from verified evidence.",
      "Do not use positional selection to hide the ambiguity.",
    ],
  },
  {
    pattern: /No unique plan locator matched|Timed out|waiting for/i,
    hints: [
      "Inspect the failure ARIA snapshot and screenshot, then re-explore only this state.",
      "Update the locator or preceding postcondition before the next rehearsal attempt.",
    ],
  },
  {
    pattern: /URL|navigation/i,
    hints: [
      "Compare the current sanitized URL with the expected wait-for-url pattern.",
      "Confirm the preceding navigation remains same-origin and deterministic.",
    ],
  },
] as const;

function repairHints(error: string): string[] {
  const matched = repairHintRules.find((rule) => rule.pattern.test(error));
  return matched
    ? [...matched.hints]
    : [
        "Inspect the failure snapshot and trace and revise only the failing step.",
        "Re-run rehearsal with the next attempt number; final capture does not repair plans.",
      ];
}

async function closeContext(context: BrowserContext | undefined): Promise<void> {
  await context?.close().catch(() => undefined);
}

/** Replays a plan without recording video and captures evidence at the first failing step. */
export async function rehearseDemoPlan(options: {
  plan: DemoPlan;
  planPath: string;
  outputDirectory: string;
  attempt: number;
  headless: boolean;
  storageStatePath?: string;
  sessionStoragePath?: string;
  fast?: boolean;
}): Promise<RehearsalReport> {
  if (!Number.isInteger(options.attempt) || options.attempt < 1 || options.attempt > 3)
    throw new Error("Rehearsal attempt must be between 1 and 3");
  const artifacts = new ExplorationArtifactStore(options.outputDirectory);
  await artifacts.initialize(["diagnostics"]);
  const reportArtifact = "rehearsal.json";
  const traceArtifact = "diagnostics/trace.zip";
  const failureSnapshot = "diagnostics/failure.yml";
  const failureScreenshot = "diagnostics/failure.png";
  const finalScreenshot = "final.png";
  const browser = await chromium.launch({ headless: options.headless });
  let context: BrowserContext | undefined;
  const steps: RehearsalStepResult[] = [];
  const createdAt = new Date().toISOString();
  let failure: RehearsalReport["failure"];
  let traceAvailable = false;
  let failureEvidence = false;
  let finalEvidence = false;

  try {
    context = await createGuardedBrowserContext(browser, {
      baseUrl: options.plan.target.baseUrl,
      viewport: options.plan.capture.viewport ?? { width: 1440, height: 900 },
      ...(options.storageStatePath ? { storageStatePath: options.storageStatePath } : {}),
      ...(options.sessionStoragePath ? { sessionStoragePath: options.sessionStoragePath } : {}),
    });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    const page = await context.newPage();
    attachBlockedInteractionHandlers(page);

    for (const [index, step] of options.plan.capture.steps.entries()) {
      const startedAt = Date.now();
      try {
        await executeRehearsalAction(options.plan, page, step, options.fast ?? false);
        steps.push({
          index: index + 1,
          type: step.type,
          ...(step.purpose ? { purpose: step.purpose } : {}),
          status: "passed",
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        const message = sanitizeExplorationError(errorWithCauses(error));
        steps.push({
          index: index + 1,
          type: step.type,
          ...(step.purpose ? { purpose: step.purpose } : {}),
          status: "failed",
          durationMs: Date.now() - startedAt,
          error: message,
        });
        failure = {
          stepIndex: index + 1,
          url: sanitizeExplorationUrl(page.url()),
          title: await page.title().catch(() => ""),
          error: message,
          repairHints: repairHints(message),
        };
        const snapshot = await page
          .ariaSnapshot({ mode: "ai", depth: 12, timeout: 5_000 })
          .catch(() => "");
        failureEvidence = await Promise.all([
          artifacts.writeText(
            failureSnapshot,
            `${snapshot.trimEnd()}\n`,
            explorationArtifactLimits.snapshotBytes,
          ),
          artifacts.writeExternalFile(
            failureScreenshot,
            explorationArtifactLimits.screenshotBytes,
            (path) => page.screenshot({ path, fullPage: false, scale: "css" }).then(() => {}),
          ),
        ])
          .then(() => true)
          .catch(() => false);
        break;
      }
    }
    if (!failure) {
      await artifacts.writeExternalFile(
        finalScreenshot,
        explorationArtifactLimits.screenshotBytes,
        (path) => page.screenshot({ path, fullPage: false, scale: "css" }).then(() => {}),
      );
      finalEvidence = true;
    }
  } finally {
    if (context) {
      traceAvailable = await artifacts
        .writeExternalFile(traceArtifact, explorationArtifactLimits.traceBytes, (path) =>
          context!.tracing.stop({ path }),
        )
        .then(() => true)
        .catch(() => false);
      await closeContext(context);
    }
    await browser.close().catch(() => undefined);
  }

  const id = options.outputDirectory.split(/[\\/]/).pop() ?? "rehearsal";
  const report: RehearsalReport = {
    version: 1,
    id,
    planName: options.plan.name,
    planPath: options.planPath,
    attempt: options.attempt,
    maxAttempts: 3,
    mode: options.fast ? "fast" : "full",
    status: failure ? "failed" : "passed",
    createdAt,
    finishedAt: new Date().toISOString(),
    steps,
    ...(failure ? { failure } : {}),
    artifacts: {
      report: reportArtifact,
      ...(traceAvailable ? { trace: traceArtifact } : {}),
      ...(failureEvidence ? { failureSnapshot, failureScreenshot } : {}),
      ...(finalEvidence ? { finalScreenshot } : {}),
    },
  };
  await artifacts.writeJson(reportArtifact, report);
  return report;
}

export async function rehearsePlanFile(options: {
  planArgument: string;
  outputDirectory?: string;
  attempt?: number;
  headless?: boolean;
  fast?: boolean;
}): Promise<{ outputDirectory: string; report: RehearsalReport }> {
  const planPath = resolve(workingDirectory, options.planArgument);
  const plan = await loadDemoPlan(planPath);
  const attempt = options.attempt ?? 1;
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 3)
    throw new Error("Rehearsal attempt must be between 1 and 3");
  const id = `${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}-${plan.name}-attempt-${attempt}-${randomUUID().slice(0, 8)}`;
  const outputDirectory = resolve(
    workingDirectory,
    options.outputDirectory ?? join(".demo-recorder", "rehearsals", id),
  );
  const repositoryPath = resolve(workingDirectory, plan.target.repositoryPath ?? ".");
  let managed: Awaited<ReturnType<typeof startManagedApp>> | undefined;
  try {
    if (plan.target.startCommand)
      managed = await startManagedApp({
        command: plan.target.startCommand,
        cwd: repositoryPath,
        readinessUrl: plan.target.readinessUrl ?? plan.target.baseUrl,
      });
    const authPaths = plan.target.authProfile
      ? authProfilePaths(join(workingDirectory, ".demo-recorder/auth"), plan.target.authProfile)
      : undefined;
    const report = await rehearseDemoPlan({
      plan,
      planPath,
      outputDirectory,
      attempt,
      headless: options.headless ?? true,
      fast: options.fast ?? false,
      ...(authPaths
        ? {
            storageStatePath: authPaths.storageStatePath,
            sessionStoragePath: authPaths.sessionStoragePath,
          }
        : {}),
    });
    return { outputDirectory, report };
  } finally {
    await managed?.close().catch(() => undefined);
  }
}
