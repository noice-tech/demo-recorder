import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parsePlan, planOrigins } from "@noice-tech/demo-recorder-core";
import { ActionError } from "../driver/action-error.js";
import { selectDriver } from "../driver/index.js";
import type { Session } from "../driver/types.js";
import {
  actionTarget,
  revealTarget,
  scrollToTarget,
  type RevealSurface,
} from "../motion/reveal.js";
import { PlanRunError, executePlan, type PlanSession } from "../runner.js";
import {
  booleanOption,
  stringOption,
  type OptionDefinitions,
  type ParsedArguments,
} from "../support/args.js";
import { readJson, writeFileAtomic, writeJsonAtomic } from "../support/files.js";
import { requirePresentationFits } from "../renderer/prepare-recording.js";
import { planDigest } from "../support/rehearsal.js";

/** Holds only pace the recording; rehearsal checks the steps without sitting through them. */
const REHEARSAL_HOLD_MS = 250;

export const rehearseOptions: OptionDefinitions = {
  project: { type: "string" },
  plan: { type: "string" },
  driver: { type: "string" },
  headed: { type: "boolean" },
  "storage-state": { type: "string" },
};

/** Returns the evidence files written; a page stuck mid-navigation may yield none. */
async function writeEvidence(project: string, step: number, session: Session): Promise<string[]> {
  const screenshot = `evidence/step-${step}.png`;
  const snapshot = `evidence/step-${step}.yml`;
  // Remove files from an earlier rehearsal so they cannot pass for this one.
  await Promise.all([screenshot, snapshot].map((path) => rm(join(project, path), { force: true })));
  const written = await Promise.all([
    session.screenshot(join(project, screenshot)).then(
      () => screenshot,
      () => undefined,
    ),
    session
      .snapshot()
      .then((text) => writeFileAtomic(join(project, snapshot), text))
      .then(
        () => snapshot,
        () => undefined,
      ),
  ]);
  return written.filter((path): path is string => path !== undefined);
}

/** Writes the failure report and evidence; returns the error to throw. */
export async function planFailure(input: {
  project: string;
  report: string;
  planPath: string;
  name: string;
  session: Session;
  error: PlanRunError;
}): Promise<Error> {
  const { project, error } = input;
  const evidence = await writeEvidence(project, error.step, input.session);
  await writeJsonAtomic(join(project, input.report), {
    ok: false,
    captureReady: false,
    name: input.name,
    plan: input.planPath,
    error: error.message,
    ...(error.cause instanceof ActionError ? { callLog: error.cause.callLog } : {}),
    steps: error.reports,
  });
  const saved =
    evidence.length > 0
      ? `Evidence: ${input.report}, ${evidence.join(", ")}`
      : `No evidence: the page could not be read. Report: ${input.report}`;
  return new Error(`${error.message.replace(/\.$/, "")}. ${saved}`, { cause: error });
}

export function resolvePlanPath(args: ParsedArguments): { project: string; planPath: string } {
  const project = resolve(stringOption(args, "project") ?? ".");
  const planPath = resolve(
    stringOption(args, "plan") ?? args.positionals[0] ?? join(project, "plan.json"),
  );
  return { project, planPath };
}

/** Deprecated aliases: plan validate | plan show. */
export async function planValidate(args: ParsedArguments): Promise<unknown> {
  const { planPath } = resolvePlanPath(args);
  const plan = parsePlan(await readJson(planPath));
  return { ok: true, name: plan.name, steps: plan.steps.length };
}

export async function planShow(args: ParsedArguments): Promise<unknown> {
  const { planPath } = resolvePlanPath(args);
  return parsePlan(await readJson(planPath));
}

export async function planRehearse(args: ParsedArguments): Promise<unknown> {
  const { project, planPath } = resolvePlanPath(args);
  const plan = parsePlan(await readJson(planPath));
  await requirePresentationFits(project, plan);
  const driver = selectDriver(stringOption(args, "driver") ?? "playwright");
  const storageStatePath = stringOption(args, "storage-state");
  const session = await driver.connect({
    mode: "launched",
    headless: !booleanOption(args, "headed"),
    viewport: plan.viewport,
    allowedOrigins: planOrigins(plan),
    ...(storageStatePath ? { storageStatePath } : {}),
  });

  // Reveal targets the same way the recorder does, so a target that cannot be
  // scrolled into view fails here instead of after a full capture.
  const revealSurface: RevealSurface = {
    bounds: (target) => session.bounds(target),
    present: async (target) => (await session.countMatches(target)) > 0,
    scroll: (deltaX, deltaY) => session.perform({ type: "scroll", deltaX, deltaY }),
    scrollY: async () => (await session.scrollPosition()).y,
    wait: (durationMs) => new Promise((done) => setTimeout(done, durationMs)),
  };
  const planSession: PlanSession = {
    perform: async (action) => {
      if (action.type === "hold") {
        await session.perform({
          ...action,
          durationMs: Math.min(action.durationMs, REHEARSAL_HOLD_MS),
        });
        return;
      }
      if (action.type === "scroll" && "to" in action && action.to) {
        await scrollToTarget(revealSurface, action.to, plan.viewport);
        return;
      }
      const target = actionTarget(action);
      if (target) {
        await revealTarget(revealSurface, target, plan.viewport);
      }
      await session.perform(action);
    },
    waitFor: (expect) => session.waitFor(expect),
    url: () => session.url(),
  };

  try {
    await session.goto(plan.target.baseUrl);
    const steps = await executePlan({ plan, session: planSession });
    const report = {
      ok: true,
      captureReady: true,
      name: plan.name,
      plan: planPath,
      planDigest: planDigest(plan),
      steps,
    };
    await writeJsonAtomic(join(project, "rehearsal-report.json"), report);
    return report;
  } catch (error) {
    if (error instanceof PlanRunError) {
      throw await planFailure({
        project,
        report: "rehearsal-report.json",
        planPath,
        name: plan.name,
        session,
        error,
      });
    }
    throw error;
  } finally {
    await session.close();
  }
}
