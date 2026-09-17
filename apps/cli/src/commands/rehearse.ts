import { join, resolve } from "node:path";
import { parsePlan } from "@noice-tech/demo-recorder-core";
import { selectDriver } from "../driver/index.js";
import type { Session } from "../driver/types.js";
import { PlanRunError, executePlan } from "../runner.js";
import {
  booleanOption,
  stringOption,
  type OptionDefinitions,
  type ParsedArguments,
} from "../support/args.js";
import { readJson, writeFileAtomic, writeJsonAtomic } from "../support/files.js";
import { planDigest } from "../support/rehearsal.js";

export const rehearseOptions: OptionDefinitions = {
  project: { type: "string" },
  plan: { type: "string" },
  driver: { type: "string" },
  headed: { type: "boolean" },
  "storage-state": { type: "string" },
};

async function writeEvidence(project: string, step: number, session: Session): Promise<void> {
  await Promise.all([
    session.screenshot(join(project, "evidence", `step-${step}.png`)).catch(() => undefined),
    session
      .snapshot()
      .then((snapshot) => writeFileAtomic(join(project, "evidence", `step-${step}.yml`), snapshot))
      .catch(() => undefined),
  ]);
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
  const driver = selectDriver(stringOption(args, "driver") ?? "playwright");
  const storageStatePath = stringOption(args, "storage-state");
  const session = await driver.connect({
    mode: "launched",
    headless: !booleanOption(args, "headed"),
    viewport: plan.viewport,
    ...(storageStatePath ? { storageStatePath } : {}),
  });

  try {
    await session.goto(plan.target.baseUrl);
    const steps = await executePlan({ plan, session });
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
      await writeEvidence(project, error.step, session);
      await writeJsonAtomic(join(project, "rehearsal-report.json"), {
        ok: false,
        captureReady: false,
        name: plan.name,
        plan: planPath,
        error: error.message,
        steps: error.reports,
      });
      throw new Error(`${error.message}. Evidence: evidence/step-${error.step}.png`, {
        cause: error,
      });
    }
    throw error;
  } finally {
    await session.close();
  }
}
