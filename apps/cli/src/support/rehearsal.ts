import { createHash } from "node:crypto";
import type { Plan } from "@noice-tech/demo-recorder-core";

/** Bind approval to the parsed plan, not a filename that can be edited in place. */
export function planDigest(plan: Plan): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}
