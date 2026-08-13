import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  estimatePlanDurationMs,
  exportDemoPlanToPlaywright,
  importPlaywrightTest,
  loadDemoPlan,
  planStoryboard,
} from "./demo-plan/index.js";
import { workingDirectory } from "./paths.js";

function planPath(value: string): string {
  return resolve(workingDirectory, value);
}

export async function validatePlanCommand(value: string): Promise<void> {
  const plan = await loadDemoPlan(planPath(value));
  const estimated = estimatePlanDurationMs(plan);
  console.log(`[demo-recorder] Plan is valid: ${plan.name}`);
  console.log(
    `[demo-recorder] ${plan.capture.steps.length} steps, approximately ${(estimated / 1000).toFixed(1)} seconds`,
  );
  if (plan.brief.targetDurationMs && estimated > plan.brief.targetDurationMs * 1.25) {
    console.warn(`[demo-recorder] Warning: estimated duration exceeds the target by more than 25%`);
  }
}

export async function showPlanCommand(value: string): Promise<void> {
  console.log(planStoryboard(await loadDemoPlan(planPath(value))));
}

async function writeOutput(path: string, contents: string): Promise<string> {
  const destination = resolve(workingDirectory, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, contents, "utf8");
  return destination;
}

export async function importPlaywrightCommand(options: {
  path: string;
  output: string;
  baseUrl: string;
  test?: string;
  name?: string;
  goal?: string;
  allowModifyData: boolean;
  allowSubmitForms: boolean;
  allowCrossOrigin: boolean;
}): Promise<{ output: string; test: string }> {
  const result = await importPlaywrightTest({
    ...options,
    path: planPath(options.path),
  });
  if (!result.plan) {
    const available = result.tests.length
      ? `\nAvailable tests:\n${result.tests.map((test) => `- ${test}`).join("\n")}`
      : "";
    const details = result.diagnostics
      .map((item) => `${options.path}:${item.line}: ${item.message}`)
      .join("\n");
    throw new Error(`Unable to import Playwright test\n${details}${available}`);
  }
  const output = await writeOutput(options.output, `${JSON.stringify(result.plan, null, 2)}\n`);
  return { output, test: result.selectedTest ?? result.plan.name };
}

export async function exportPlaywrightCommand(options: {
  path: string;
  output: string;
  preserveHolds: boolean;
  importSource?: string;
}): Promise<{ output: string; warnings: string[] }> {
  const plan = await loadDemoPlan(planPath(options.path));
  const generated = exportDemoPlanToPlaywright(plan, options);
  return {
    output: await writeOutput(options.output, generated.source),
    warnings: generated.warnings,
  };
}
