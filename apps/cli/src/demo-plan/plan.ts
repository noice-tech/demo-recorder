import { readFile } from "node:fs/promises";
import type { z } from "zod";
import {
  destructiveActionPattern,
  formSubmissionPattern,
  mutationActionPattern,
} from "../browser/action-risk.js";
import { scrollDurationMs } from "../browser/smooth-scroll.js";
import { demoActionSchema, demoPlanSchema, locatorSchema } from "./schema.js";

export type LocatorSpec = z.infer<typeof locatorSchema>;
export type DemoAction = z.infer<typeof demoActionSchema>;
export type DemoPlan = z.infer<typeof demoPlanSchema>;

function locatorText(locator: LocatorSpec): string {
  const method = locator.primary;
  if (method.by === "role") return `${method.role} ${method.name ?? ""}`;
  if (method.by === "text") return method.text;
  if (method.by === "label") return method.label;
  if (method.by === "placeholder") return method.placeholder;
  if (method.by === "test-id") return method.testId;
  return method.selector;
}

export function parseDemoPlan(value: unknown): DemoPlan {
  const plan = demoPlanSchema.parse(value);
  const baseOrigin = new URL(plan.target.baseUrl).origin;
  for (const [index, step] of plan.capture.steps.entries()) {
    if (step.type === "navigate") {
      const destination = new URL(step.url, plan.target.baseUrl);
      if (plan.brief.constraints.sameOriginOnly && destination.origin !== baseOrigin) {
        throw new Error(
          `Step ${index + 1} navigates outside the target origin: ${destination.href}`,
        );
      }
    }
    if (step.type === "click") {
      const description = locatorText(step.locator);
      if (destructiveActionPattern.test(description)) {
        throw new Error(`Step ${index + 1} appears destructive: ${description}`);
      }
      if (!plan.brief.constraints.modifyData && mutationActionPattern.test(description)) {
        throw new Error(
          `Step ${index + 1} may modify data while modifyData is disabled: ${description}`,
        );
      }
      if (!plan.brief.constraints.submitForms && formSubmissionPattern.test(description)) {
        throw new Error(
          `Step ${index + 1} may submit a form while submitForms is disabled: ${description}`,
        );
      }
    }
    if (!plan.brief.constraints.modifyData && ["fill", "press", "select"].includes(step.type)) {
      throw new Error(`Step ${index + 1} uses ${step.type} while modifyData is disabled`);
    }
  }
  return plan;
}

export async function loadDemoPlan(path: string): Promise<DemoPlan> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read demo plan: ${path}`, { cause: error });
  }
  try {
    return parseDemoPlan(value);
  } catch (error) {
    throw new Error(`Invalid demo plan: ${path}`, { cause: error });
  }
}

export function estimatePlanDurationMs(plan: DemoPlan): number {
  return plan.capture.steps.reduce((total, step) => {
    if (step.type === "hold") return total + step.durationMs;
    if (step.type === "move") return total + (step.durationMs ?? 700);
    if (step.type === "click") return total + 900;
    if (step.type === "navigate") return total + 1_500;
    if (step.type === "scroll") return total + scrollDurationMs(step.deltaY, step.deltaX ?? 0);
    if (["wait-for", "wait-for-url", "assert-visible"].includes(step.type)) return total + 300;
    return total + 500;
  }, 0);
}

export function planStoryboard(plan: DemoPlan): string {
  const lines = [
    `# ${plan.name}`,
    "",
    plan.brief.goal,
    "",
    `Target: ${plan.target.baseUrl}`,
    `Estimated duration: ${(estimatePlanDurationMs(plan) / 1000).toFixed(1)} seconds`,
    "",
    "## Actions",
    "",
  ];
  for (const [index, step] of plan.capture.steps.entries()) {
    const detail =
      step.type === "navigate"
        ? step.url
        : step.type === "hold"
          ? `${step.durationMs}ms`
          : "locator" in step
            ? locatorText(step.locator)
            : step.type;
    lines.push(`${index + 1}. **${step.type}** — ${step.purpose ?? detail}`);
  }
  if (plan.presentation.beats.length > 0) {
    lines.push("", "## Story beats", "");
    for (const beat of plan.presentation.beats) lines.push(`- ${beat.label} (${beat.importance})`);
  }
  return `${lines.join("\n")}\n`;
}
