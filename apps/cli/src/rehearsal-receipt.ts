import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { chromium } from "playwright";
import type { DemoPlan } from "./demo-plan/index.js";
import { workingDirectory } from "./paths.js";
import { cliVersion } from "./version.js";

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

export function rehearsalFingerprint(plan: DemoPlan, headless: boolean): string {
  // Presentation-only changes can be rendered without repeating browser work.
  return hash(
    JSON.stringify({
      capture: plan.capture,
      target: plan.target,
      constraints: plan.brief.constraints,
      repository: resolve(workingDirectory, plan.target.repositoryPath ?? "."),
      runtime: cliVersion,
      browser: chromium.executablePath(),
      platform: process.platform,
      headless,
    }),
  );
}

export function rehearsalReceiptPath(planPath: string): string {
  return join(
    workingDirectory,
    ".demo-recorder/rehearsals/receipts",
    `${hash(resolve(planPath))}.json`,
  );
}

export async function saveRehearsalReceipt(
  planPath: string,
  fingerprint: string,
  reportPath: string,
): Promise<void> {
  const path = rehearsalReceiptPath(planPath);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporary,
      JSON.stringify({ version: 1, fingerprint, reportPath, createdAt: new Date().toISOString() }),
      { mode: 0o600 },
    );
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function requireRehearsalReceipt(
  planPath: string,
  plan: DemoPlan,
  headless: boolean,
): Promise<void> {
  const receipt = await readFile(rehearsalReceiptPath(planPath), "utf8")
    .then((text) => JSON.parse(text) as { version?: number; fingerprint?: string })
    .catch(() => undefined);
  if (receipt?.version !== 1 || receipt.fingerprint !== rehearsalFingerprint(plan, headless))
    throw new Error(
      `Missing or stale full rehearsal. Run: demo-recorder plan rehearse ${JSON.stringify(planPath)}${headless ? "" : " --headed"}. Expert bypass: --skip-rehearsal`,
    );
}
