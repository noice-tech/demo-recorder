import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "playwright";
import { resolveUniqueLocator, resolveVisibleClickTarget } from "../browser/locator.js";
import { withPlanPolicy } from "../browser/plan-policy.js";
import type { DemoAction, DemoPlan, LocatorSpec } from "../demo-plan/index.js";
import { createRecordingSession } from "./session.js";
import type { DemoActions, RecordingSessionOptions } from "./types.js";

export async function resolvePlanLocator(
  page: Page,
  spec: LocatorSpec,
  timeoutMs?: number,
): Promise<Locator> {
  return (
    await resolveUniqueLocator(page, [spec.primary, ...(spec.fallbacks ?? [])], {
      description: "No unique plan locator matched",
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    })
  ).locator;
}

export async function executeAction(
  page: Page,
  actions: DemoActions,
  step: DemoAction,
): Promise<void> {
  if (step.type === "navigate") return actions.goto(step.url);
  if (step.type === "scroll") return actions.scroll(step.deltaY, step.deltaX);
  if (step.type === "hold") return actions.wait(step.durationMs);
  if (step.type === "wait-for-url")
    return actions.waitForUrl(
      step.urlPattern,
      step.timeoutMs === undefined ? undefined : { timeoutMs: step.timeoutMs },
    );
  if (step.type === "press") {
    const locator = step.locator ? await resolvePlanLocator(page, step.locator) : undefined;
    return actions.press(step.key, locator);
  }
  const locator = await resolvePlanLocator(
    page,
    step.locator,
    "timeoutMs" in step ? step.timeoutMs : undefined,
  );
  // Resolution already waits for one visible target using the action's entire budget.
  if (step.type === "wait-for" || step.type === "assert-visible") return;
  if (step.type === "move")
    return actions.moveTo(
      locator,
      step.durationMs === undefined ? undefined : { durationMs: step.durationMs },
    );
  if (step.type === "click") {
    const clickTarget = await resolveVisibleClickTarget(page, locator);
    return actions.click(
      clickTarget,
      step.button === undefined ? undefined : { button: step.button },
    );
  }
  if (step.type === "fill") return actions.fill(locator, step.value);
  if (step.type === "select") return actions.select(locator, step.value);
  const unsupported: never = step;
  throw new Error(`Unsupported plan action: ${String(unsupported)}`);
}

export async function executeDemoPlan(
  plan: DemoPlan,
  page: Page,
  actions: DemoActions,
): Promise<void> {
  for (const [index, step] of plan.capture.steps.entries()) {
    try {
      await withPlanPolicy(page, () => executeAction(page, actions, step));
    } catch (error) {
      throw new Error(
        `Plan step ${index + 1} (${step.type}) failed${step.purpose ? `: ${step.purpose}` : ""}`,
        { cause: error },
      );
    }
  }
}

export async function recordDemoPlan(plan: DemoPlan, options: RecordingSessionOptions) {
  const session = await createRecordingSession({ ...options, baseUrl: plan.target.baseUrl, plan });
  let manifest;
  try {
    await executeDemoPlan(plan, session.page, session.actions);
    manifest = await session.stop();
  } catch (error) {
    await session.abort().catch(() => undefined);
    throw new Error("Plan recording failed", { cause: error });
  }
  await writeFile(
    join(options.outputDirectory, "demo-plan.json"),
    `${JSON.stringify(plan, null, 2)}\n`,
  );
  await writeFile(
    join(options.outputDirectory, "presentation.json"),
    `${JSON.stringify(plan.presentation, null, 2)}\n`,
  );
  return manifest;
}
