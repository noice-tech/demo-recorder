import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, openSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDemoPlan, type DemoPlan } from "../demo-plan/index.js";
import {
  explorationDraftPlanRequestSchema,
  explorationFindQuerySchema,
  explorationFindResultSchema,
  explorationLaunchConfigSchema,
  explorationObservationSchema,
  explorationSessionDescriptorSchema,
  explorationSessionReportSchema,
  explorationTransitionSchema,
  explorationVerificationReportSchema,
  explorationVerificationRequestSchema,
  type ExplorationAction,
  type ExplorationDraftPlanRequest,
  type ExplorationFindQuery,
  type ExplorationFindResult,
  type ExplorationLaunchConfig,
  type ExplorationObservation,
  type ExplorationSessionDescriptor,
  type ExplorationSessionReport,
  type ExplorationTransition,
  type ExplorationVerificationReport,
  type ExplorationVerificationRequest,
} from "./interactive-schema.js";

function validateSessionId(id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id))
    throw new Error(`Invalid exploration session ID: ${id}`);
  return id;
}

function sessionPaths(rootDirectory: string, id: string) {
  const root = resolve(rootDirectory);
  const safe = validateSessionId(id);
  return {
    descriptorPath: join(root, `${safe}.json`),
    launchConfigPath: join(root, `${safe}.launch.json`),
  };
}

async function readDescriptor(
  rootDirectory: string,
  id: string,
): Promise<ExplorationSessionDescriptor> {
  const { descriptorPath } = sessionPaths(rootDirectory, id);
  try {
    return explorationSessionDescriptorSchema.parse(
      JSON.parse(await readFile(descriptorPath, "utf8")) as unknown,
    );
  } catch (error) {
    throw new Error(`No active exploration session: ${id}`, { cause: error });
  }
}

async function request<T>(
  descriptor: ExplorationSessionDescriptor,
  path: string,
  options?: { body?: unknown; method?: "GET" | "POST" },
): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${descriptor.port}${path}`, {
    method: options?.method ?? "GET",
    headers: {
      authorization: `Bearer ${descriptor.token}`,
      ...(options?.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(options?.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const result = (await response.json()) as { ok?: boolean; error?: string } & T;
  if (!response.ok || !result.ok)
    throw new Error(result.error ?? `Exploration session request failed: HTTP ${response.status}`);
  return result;
}

export async function startInteractiveSession(options: {
  sessionRoot: string;
  config: ExplorationLaunchConfig;
}): Promise<{ descriptor: ExplorationSessionDescriptor; observation: ExplorationObservation }> {
  const config = explorationLaunchConfigSchema.parse(options.config);
  await Promise.all([
    mkdir(options.sessionRoot, { recursive: true, mode: 0o700 }),
    mkdir(join(config.outputDirectory, "diagnostics"), { recursive: true }),
  ]);
  const { descriptorPath, launchConfigPath } = sessionPaths(options.sessionRoot, config.id);
  if (existsSync(descriptorPath)) {
    const existing = await readDescriptor(options.sessionRoot, config.id).catch(() => undefined);
    if (existing) {
      const alive = await request<{ report: ExplorationSessionReport }>(existing, "/status").catch(
        () => undefined,
      );
      if (alive) throw new Error(`Exploration session is already active: ${config.id}`);
    }
    await rm(descriptorPath, { force: true });
  }
  await writeFile(launchConfigPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  const token = randomBytes(24).toString("hex");
  const sourceDaemon = fileURLToPath(new URL("./session-daemon.ts", import.meta.url));
  const builtDaemon = fileURLToPath(new URL("./exploration-daemon.js", import.meta.url));
  const daemon = existsSync(sourceDaemon) ? sourceDaemon : builtDaemon;
  const daemonArguments = daemon.endsWith(".ts")
    ? ["--import", "tsx", daemon, launchConfigPath, descriptorPath, token]
    : [daemon, launchConfigPath, descriptorPath, token];
  const daemonLogPath = join(config.outputDirectory, "diagnostics", "daemon.log");
  const daemonLog = openSync(daemonLogPath, "a", 0o600);
  const child = spawn(process.execPath, daemonArguments, {
    detached: true,
    stdio: ["ignore", daemonLog, daemonLog],
    cwd: process.cwd(),
  });
  closeSync(daemonLog);
  child.unref();
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      await rm(launchConfigPath, { force: true });
      const daemonError = await readFile(daemonLogPath, "utf8").catch(() => "");
      throw new Error(
        `Exploration daemon exited with code ${child.exitCode}${daemonError.trim() ? `\n${daemonError.trim().slice(-4_000)}` : ""}`,
      );
    }
    const descriptor = await readDescriptor(options.sessionRoot, config.id).catch(() => undefined);
    if (descriptor) {
      const status = await request<{ report: ExplorationSessionReport }>(
        descriptor,
        "/status",
      ).catch(() => undefined);
      if (status?.report.latestObservationId) {
        const observationPath = join(
          descriptor.outputDirectory,
          "observations",
          `${status.report.latestObservationId}.json`,
        );
        const observation = explorationObservationSchema.parse(
          JSON.parse(await readFile(observationPath, "utf8")) as unknown,
        );
        return { descriptor, observation };
      }
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  await rm(launchConfigPath, { force: true });
  const daemonError = await readFile(daemonLogPath, "utf8").catch(() => "");
  throw new Error(
    `Exploration daemon did not start within 30 seconds${daemonError.trim() ? `\n${daemonError.trim().slice(-4_000)}` : ""}`,
  );
}

export async function interactiveSessionDirectory(
  sessionRoot: string,
  id: string,
): Promise<string> {
  return (await readDescriptor(sessionRoot, id)).outputDirectory;
}

export async function observeInteractiveSession(
  sessionRoot: string,
  id: string,
): Promise<ExplorationObservation> {
  const descriptor = await readDescriptor(sessionRoot, id);
  const result = await request<{ observation: unknown }>(descriptor, "/observe", {
    method: "POST",
  });
  return explorationObservationSchema.parse(result.observation);
}

export async function findInInteractiveSession(
  sessionRoot: string,
  id: string,
  query: ExplorationFindQuery,
): Promise<ExplorationFindResult> {
  const descriptor = await readDescriptor(sessionRoot, id);
  const result = await request<{ result: unknown }>(descriptor, "/find", {
    method: "POST",
    body: explorationFindQuerySchema.parse(query),
  });
  return explorationFindResultSchema.parse(result.result);
}

export async function actInInteractiveSession(
  sessionRoot: string,
  id: string,
  action: ExplorationAction,
): Promise<ExplorationTransition> {
  const descriptor = await readDescriptor(sessionRoot, id);
  const result = await request<{ transition: unknown }>(descriptor, "/act", {
    method: "POST",
    body: action,
  });
  return explorationTransitionSchema.parse(result.transition);
}

export async function exportInteractiveSessionPlan(
  sessionRoot: string,
  id: string,
  input: ExplorationDraftPlanRequest,
): Promise<DemoPlan> {
  const descriptor = await readDescriptor(sessionRoot, id);
  const result = await request<{ plan: unknown }>(descriptor, "/export-plan", {
    method: "POST",
    body: explorationDraftPlanRequestSchema.parse(input),
  });
  return parseDemoPlan(result.plan);
}

export async function verifyInteractiveSession(
  sessionRoot: string,
  id: string,
  input: ExplorationVerificationRequest,
): Promise<ExplorationVerificationReport> {
  const descriptor = await readDescriptor(sessionRoot, id);
  const result = await request<{ verification: unknown }>(descriptor, "/verify", {
    method: "POST",
    body: explorationVerificationRequestSchema.parse(input),
  });
  return explorationVerificationReportSchema.parse(result.verification);
}

export async function finishInteractiveSession(
  sessionRoot: string,
  id: string,
  abort = false,
): Promise<ExplorationSessionReport> {
  const descriptor = await readDescriptor(sessionRoot, id);
  const result = await request<{ report: unknown }>(descriptor, abort ? "/abort" : "/finish", {
    method: "POST",
  });
  return explorationSessionReportSchema.parse(result.report);
}

export async function interactiveSessionStatus(
  sessionRoot: string,
  id: string,
): Promise<ExplorationSessionReport> {
  const descriptor = await readDescriptor(sessionRoot, id);
  const result = await request<{ report: unknown }>(descriptor, "/status");
  return explorationSessionReportSchema.parse(result.report);
}

export async function listInteractiveSessions(sessionRoot: string): Promise<string[]> {
  const entries = await readdir(sessionRoot, { withFileTypes: true }).catch(() => []);
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.endsWith(".launch.json"))
      continue;
    const id = entry.name.slice(0, -5);
    const descriptor = await readDescriptor(sessionRoot, id).catch(() => undefined);
    if (!descriptor) continue;
    const alive = await request(descriptor, "/status").catch(() => undefined);
    if (alive) ids.push(id);
    else await rm(join(sessionRoot, entry.name), { force: true });
  }
  ids.sort();
  return ids;
}
