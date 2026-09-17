import type { Plan, PlanStep } from "@noice-tech/demo-recorder-core";
import type { Session } from "./driver/types.js";

/** The subset of a session the runner needs; a recorder can wrap it. */
export type PlanSession = Pick<Session, "perform" | "waitFor" | "url">;

export type PlanStepReport = {
  step: number;
  type: PlanStep["type"];
  purpose: string | undefined;
  checked: boolean;
  ok: boolean;
  url: string;
};

export class PlanRunError extends Error {
  readonly step: number;
  readonly reports: PlanStepReport[];

  constructor(
    step: number,
    message: string,
    reports: PlanStepReport[],
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "PlanRunError";
    this.step = step;
    this.reports = reports;
  }
}

/**
 * One path for verification and capture: perform each step by its durable
 * target, then require every `expect` condition to hold.
 */
export async function executePlan(input: {
  plan: Plan;
  session: PlanSession;
  beforeStep?: (stepNumber: number, step: PlanStep) => void;
  onStep?: (report: PlanStepReport) => void;
}): Promise<PlanStepReport[]> {
  const { plan, session, beforeStep, onStep } = input;
  const reports: PlanStepReport[] = [];

  for (const [index, step] of plan.steps.entries()) {
    const stepNumber = index + 1;
    beforeStep?.(stepNumber, step);
    try {
      await session.perform(step);
      if (step.expect) await session.waitFor(step.expect);
    } catch (error) {
      const report: PlanStepReport = {
        step: stepNumber,
        type: step.type,
        purpose: step.purpose,
        checked: Boolean(step.expect),
        ok: false,
        url: await session.url().catch(() => ""),
      };
      reports.push(report);
      const reason = error instanceof Error ? error.message : String(error);
      throw new PlanRunError(
        stepNumber,
        `Step ${stepNumber} (${step.type}) failed: ${reason}`,
        reports,
        {
          cause: error,
        },
      );
    }
    const report: PlanStepReport = {
      step: stepNumber,
      type: step.type,
      purpose: step.purpose,
      checked: Boolean(step.expect),
      ok: true,
      url: await session.url().catch(() => ""),
    };
    reports.push(report);
    onStep?.(report);
  }

  return reports;
}
