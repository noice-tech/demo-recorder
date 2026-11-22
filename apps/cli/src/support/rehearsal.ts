import { createHash } from "node:crypto";
import type { Plan } from "@noice-tech/demo-recorder-core";

/**
 * Binds approval to the parsed plan, not a filename that can be edited in
 * place. Hold lengths only pace the video, so changing them keeps approval.
 */
export function planDigest(plan: Plan): string {
  const steps = plan.steps.map((step) =>
    step.type === "hold" ? { ...step, durationMs: 0 } : step,
  );
  return createHash("sha256")
    .update(JSON.stringify({ ...plan, steps }))
    .digest("hex");
}
