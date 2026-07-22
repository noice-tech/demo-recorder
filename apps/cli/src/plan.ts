import { resolve } from "node:path";
import { estimatePlanDurationMs, loadDemoPlan, planStoryboard } from "./demo-plan/index.js";
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
