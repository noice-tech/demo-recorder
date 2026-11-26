import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { appendFile, readFile, rename, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { z } from "zod";

export const exec = promisify(execFile);
export const sha256 = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
export const fileHash = async (path: string) => sha256(await readFile(path));
export const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function readJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(JSON.parse(await readFile(path, "utf8")));
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`);
  await rename(temp, path);
}

export const appendJson = (path: string, data: unknown) =>
  appendFile(path, `${JSON.stringify(data)}\n`);

export async function readLines<T>(path: string, schema: z.ZodType<T>): Promise<T[]> {
  const text = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
    return "";
  });
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => schema.parse(JSON.parse(line)));
}

const budget = { budgetSeconds: z.number().int().positive(), brief: z.string().min(1) };
const caseSchema = z.discriminatedUnion("expected", [
  z.object({
    ...budget,
    page: z.literal("long.html"),
    expected: z.literal("video"),
    maxSeconds: z.number().positive(),
  }),
  z.object({ ...budget, page: z.literal("obstacles.html"), expected: z.literal("stop") }),
]);
export const casesSchema = z.object({
  version: z.literal(1),
  cases: z.record(z.string(), caseSchema),
});
export type EvalCase = z.infer<typeof caseSchema>;

export const trialSchema = z.object({
  version: z.literal(1),
  caseId: z.string(),
  case: caseSchema,
  mode: z.enum(["manual", "smoke"]),
  host: z.string(),
  model: z.string(),
  url: z.url(),
  startedAt: z.number(),
  runtime: z.object({
    entry: z.string(),
    sha256: z.string(),
    version: z.string(),
    skillSha256: z.string(),
  }),
  environment: z.object({
    node: z.string(),
    platform: z.string(),
    chromium: z.string(),
    ffmpeg: z.string(),
    ffprobe: z.string(),
  }),
});
export type Trial = z.infer<typeof trialSchema>;

export const activeSchema = z.object({ id: z.uuid(), command: z.string() });
export const signalKind = z.enum([
  "reviews-visible",
  "banner-covered",
  "banner-bypassed",
  "banner-action",
  "trial-clicked",
]);
export const signalSchema = activeSchema.extend({ kind: signalKind, at: z.number() });
export type Signal = z.infer<typeof signalSchema>;

const artifact = z.string().regex(/^[0-9a-f-]{36}$/);
export const commandSchema = activeSchema.extend({
  args: z.array(z.string()),
  startedAt: z.number(),
  finishedAt: z.number(),
  status: z.enum(["ok", "failed", "rejected", "timeout", "environment-error"]),
  candidate: artifact.optional(),
  problem: z.string().optional(),
});
export type Command = z.infer<typeof commandSchema>;

export const recordingSchema = z.object({
  id: z.string(),
  guarded: z.boolean(),
  events: z.array(
    z.object({
      type: z.string(),
      deltaY: z.number().optional(),
      url: z.string().optional(),
      step: z.number().optional(),
    }),
  ),
});
export type Recording = z.infer<typeof recordingSchema>;

export const completionSchema = z.object({
  outcome: z.enum(["completed", "agent-error", "timeout", "environment-error"]),
  at: z.number(),
});
export type Completion = z.infer<typeof completionSchema>;

export const reviewSchema = z.object({
  target: z.union([artifact, z.literal("stop")]),
  verdict: z.enum(["pass", "fail"]),
  note: z.string().trim().min(1),
});
export type Review = z.infer<typeof reviewSchema>;
