import { stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { viewportSchema } from "@noice-tech/demo-recorder-core";
import { selectDriver } from "../driver/index.js";
import type { Driver, Session } from "../driver/types.js";
import { readJson, removeFile, writeJsonAtomic } from "../support/files.js";

export const DEFAULT_LIMITS = {
  idleTimeoutMs: 300_000,
  maxDurationMs: 1_200_000,
  maxActions: 200,
} as const;

export const MAX_DURATION_MS = 3_600_000;

export const sessionFileSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  createdAt: z.iso.datetime(),
  browser: z.object({
    driver: z.string().min(1),
    mode: z.enum(["launched", "attached"]),
    target: z.string().min(1),
    owned: z.boolean(),
    pid: z.number().int().optional(),
  }),
  policy: z.enum(["read-only", "reversible"]),
  viewport: viewportSchema,
  page: z.string().optional(),
  limits: z.object({
    idleTimeoutMs: z.number().int().positive(),
    maxDurationMs: z.number().int().positive(),
    maxActions: z.number().int().positive(),
  }),
  lastObservationId: z.string().optional(),
  actions: z.number().int().nonnegative().default(0),
});

export type SessionFile = z.infer<typeof sessionFileSchema>;

export function sessionPath(project: string): string {
  return join(project, "session.json");
}

export function observationsDirectory(project: string): string {
  return join(project, "observations");
}

export function nextObservationId(last: string | undefined): string {
  const current = last ? Number(last.replace(/^obs-/, "")) : 0;
  return `obs-${String((Number.isFinite(current) ? current : 0) + 1).padStart(4, "0")}`;
}

export async function loadSessionFile(project: string): Promise<SessionFile> {
  return sessionFileSchema.parse(await readJson(sessionPath(project)));
}

export async function saveSessionFile(project: string, file: SessionFile): Promise<void> {
  await writeJsonAtomic(sessionPath(project), file);
}

export async function clearSessionFile(project: string): Promise<void> {
  await removeFile(sessionPath(project));
}

/** A session that stopped being used ends itself; the file's mtime is the heartbeat. */
export async function assertSessionFresh(project: string, file: SessionFile): Promise<void> {
  const value = await stat(sessionPath(project)).catch(() => undefined);
  if (!value) throw new Error("The session file has disappeared; run `explore start` again");
  if (Date.now() - value.mtimeMs > file.limits.idleTimeoutMs) {
    await clearSessionFile(project);
    throw new Error("The explore session expired from inactivity; run `explore start` again");
  }
  if (file.actions >= file.limits.maxActions) {
    throw new Error(`The session reached its ${file.limits.maxActions}-action limit`);
  }
}

export async function connectSession(
  project: string,
  file: SessionFile,
): Promise<{ driver: Driver; session: Session }> {
  const driver = selectDriver(file.browser.driver);
  await assertSessionFresh(project, file);
  const session = await driver.connect({
    mode: file.browser.mode,
    headless: false,
    viewport: file.viewport,
    target: file.browser.target,
    ...(file.page ? { pageId: file.page } : {}),
  });
  return { driver, session };
}
