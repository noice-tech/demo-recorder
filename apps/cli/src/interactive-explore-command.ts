import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { dimensionsOption, numberOption, stringOption, type ParsedArguments } from "./arguments.js";
import {
  actAndObserveInteractiveSession,
  authProfilePaths,
  currentInteractiveSession,
  explorationActionSchema,
  explorationDraftPlanRequestSchema,
  explorationPolicySchema,
  explorationVerificationRequestSchema,
  exportInteractiveSessionPlan,
  findInInteractiveSession,
  finishInteractiveSession,
  interactiveSessionDirectory,
  interactiveSessionStatus,
  listInteractiveSessions,
  observeInteractiveSession,
  startInteractiveSession,
  summarizeExplorationObservation,
  verifyInteractiveSession,
  type ExplorationObservation,
  type ExplorationSessionReport,
  type ExplorationTransition,
  type ExplorationVerificationReport,
} from "./explorer/index.js";
import { workingDirectory } from "./paths.js";

const operations = [
  "start",
  "observe",
  "current",
  "find",
  "act",
  "verify",
  "export-plan",
  "finish",
  "abort",
  "status",
] as const;
export type InteractiveExploreOperation = (typeof operations)[number];

export function isInteractiveExploreOperation(
  value: string | undefined,
): value is InteractiveExploreOperation {
  return operations.some((operation) => operation === value);
}

const sessionRoot = join(workingDirectory, ".demo-recorder/explorations/.sessions");

function generatedId(): string {
  return `${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}-interactive-${randomUUID().slice(0, 8)}`;
}

function resolveWorkingPath(path: string): string {
  return isAbsolute(path) ? path : resolve(workingDirectory, path);
}

function printJsonOrHuman(arguments_: ParsedArguments, value: unknown, lines: string[]): void {
  if (arguments_.options.has("json")) console.log(JSON.stringify(value, null, 2));
  else for (const line of lines) console.log(line);
}

function observationLines(observation: ExplorationObservation): string[] {
  const lines = [
    `[demo-recorder] Observation ${observation.id} (${observation.stateId})`,
    `[demo-recorder] ${observation.title || observation.url}`,
    `[demo-recorder] Snapshot: ${observation.artifacts.snapshot}`,
    `[demo-recorder] Screenshot: ${observation.artifacts.screenshot}`,
  ];
  for (const element of observation.interactiveElements.slice(0, 30))
    lines.push(
      `[${element.ref}] ${element.role ?? element.tagName.toLowerCase()} ${JSON.stringify(element.name)} — ${element.risk}${element.enabled ? "" : " (disabled)"}`,
    );
  if (observation.interactiveElements.length > 30)
    lines.push(
      `[demo-recorder] ${observation.interactiveElements.length - 30} more controls in the observation artifact`,
    );
  return lines;
}

function reportLines(report: ExplorationSessionReport): string[] {
  return [
    `[demo-recorder] Exploration ${report.id}: ${report.status}`,
    `[demo-recorder] ${report.metrics.observations} observations, ${report.metrics.states} states, ${report.metrics.transitions} transitions`,
  ];
}

function verificationLines(verification: ExplorationVerificationReport): string[] {
  return [
    `[demo-recorder] ${verification.id}: ${verification.status}`,
    `[demo-recorder] ${verification.steps.filter((step) => step.status === "passed").length}/${verification.steps.length} transitions verified in a fresh context`,
    `[demo-recorder] Report: ${verification.artifacts.report}`,
    ...(verification.artifacts.trace
      ? [`[demo-recorder] Trace: ${verification.artifacts.trace}`]
      : []),
    ...(verification.error ? [`[demo-recorder] Error: ${verification.error}`] : []),
  ];
}

function transitionLines(transition: ExplorationTransition): string[] {
  return [
    `[demo-recorder] ${transition.id}: ${transition.status}`,
    `[demo-recorder] Policy: ${transition.policy.risk} — ${transition.policy.reasons.join("; ")}`,
    ...(transition.toObservationId
      ? [`[demo-recorder] Result: ${transition.fromObservationId} → ${transition.toObservationId}`]
      : []),
    ...(transition.error ? [`[demo-recorder] Error: ${transition.error}`] : []),
  ];
}

async function startCommand(arguments_: ParsedArguments): Promise<string> {
  const url = stringOption(arguments_, "url");
  if (!url) throw new Error("explore start requires --url <http-or-https-url>");
  const repositoryPath = stringOption(arguments_, "repo");
  const resolvedRepository = repositoryPath ? resolve(workingDirectory, repositoryPath) : undefined;
  const managedStartCommand = stringOption(arguments_, "start");
  if (managedStartCommand && !resolvedRepository)
    throw new Error("--start requires --repo so the command has an explicit working directory");
  const id = stringOption(arguments_, "session") ?? generatedId();
  const outputDirectory = resolveWorkingPath(
    stringOption(arguments_, "output") ?? join(workingDirectory, ".demo-recorder/explorations", id),
  );
  const authProfile = stringOption(arguments_, "auth");
  const authPaths = authProfile
    ? authProfilePaths(join(workingDirectory, ".demo-recorder/auth"), authProfile)
    : undefined;
  const readinessUrl = stringOption(arguments_, "readiness-url");
  const goal = stringOption(arguments_, "goal");
  const { observation } = await startInteractiveSession({
    sessionRoot,
    config: {
      version: 1,
      id,
      baseUrl: url,
      outputDirectory,
      headless: !arguments_.options.has("headed"),
      viewport: dimensionsOption(arguments_, "viewport") ?? { width: 1440, height: 900 },
      policy: explorationPolicySchema.parse(stringOption(arguments_, "policy") ?? "read-only"),
      maxActions: numberOption(arguments_, "max-actions", 40),
      maxDurationMs: numberOption(arguments_, "max-duration-ms", 5 * 60_000),
      ...(resolvedRepository ? { repositoryPath: resolvedRepository } : {}),
      ...(managedStartCommand ? { startCommand: managedStartCommand } : {}),
      ...(readinessUrl ? { readinessUrl } : {}),
      ...(authPaths
        ? {
            storageStatePath: authPaths.storageStatePath,
            sessionStoragePath: authPaths.sessionStoragePath,
          }
        : {}),
      ...(authProfile ? { authProfile } : {}),
      ...(goal ? { goal } : {}),
    },
  });
  printJsonOrHuman(
    arguments_,
    {
      ok: true,
      sessionId: id,
      outputDirectory,
      observation: summarizeExplorationObservation(observation),
    },
    [
      `[demo-recorder] Exploration session started: ${id}`,
      `[demo-recorder] Output: ${outputDirectory}`,
      ...observationLines(observation),
    ],
  );
  return outputDirectory;
}

type SessionOperation = Exclude<InteractiveExploreOperation, "start">;

type SessionCommandContext = {
  arguments: ParsedArguments;
  id: string;
  outputDirectory: string;
};

type SessionCommandHandler = (context: SessionCommandContext) => Promise<string>;

async function readRequiredJson(
  arguments_: ParsedArguments,
  operation: string,
  expectedFile: string,
): Promise<unknown> {
  const inputPath = stringOption(arguments_, "input");
  if (!inputPath) throw new Error(`explore ${operation} requires --input <${expectedFile}>`);
  return JSON.parse(await readFile(resolveWorkingPath(inputPath), "utf8")) as unknown;
}

async function observeCommand(context: SessionCommandContext): Promise<string> {
  const observation = await observeInteractiveSession(sessionRoot, context.id);
  printJsonOrHuman(
    context.arguments,
    {
      ok: true,
      sessionId: context.id,
      outputDirectory: context.outputDirectory,
      observation: summarizeExplorationObservation(observation),
    },
    [`[demo-recorder] Output: ${context.outputDirectory}`, ...observationLines(observation)],
  );
  return observation.artifacts.observation;
}

async function currentCommand(context: SessionCommandContext): Promise<string> {
  const observation = await currentInteractiveSession(sessionRoot, context.id);
  printJsonOrHuman(
    context.arguments,
    {
      ok: true,
      sessionId: context.id,
      outputDirectory: context.outputDirectory,
      observation: summarizeExplorationObservation(observation),
    },
    [`[demo-recorder] Output: ${context.outputDirectory}`, ...observationLines(observation)],
  );
  return observation.artifacts.observation;
}

async function findCommand(context: SessionCommandContext): Promise<string> {
  const text = stringOption(context.arguments, "text");
  const regex = stringOption(context.arguments, "regex");
  const result = await findInInteractiveSession(sessionRoot, context.id, {
    ...(text ? { text } : {}),
    ...(regex ? { regex } : {}),
  });
  const lines = result.matches.map(
    (match) =>
      `${match.ref ? `[${match.ref}] ` : ""}${match.role ?? match.kind} ${JSON.stringify(match.text)}${match.risk ? ` — ${match.risk}` : ""}`,
  );
  printJsonOrHuman(
    context.arguments,
    { ok: true, sessionId: context.id, outputDirectory: context.outputDirectory, result },
    lines.length > 0 ? lines : ["No matches in the current observation"],
  );
  return context.id;
}

async function exportPlanCommand(context: SessionCommandContext): Promise<string> {
  const request = explorationDraftPlanRequestSchema.parse(
    await readRequiredJson(context.arguments, "export-plan", "draft-request.json"),
  );
  const plan = await exportInteractiveSessionPlan(sessionRoot, context.id, request);
  const planPath = resolveWorkingPath(
    stringOption(context.arguments, "output") ??
      join(context.outputDirectory, "draft-plans", `${request.name}.demo-plan.json`),
  );
  await mkdir(dirname(planPath), { recursive: true });
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  printJsonOrHuman(
    context.arguments,
    { ok: true, sessionId: context.id, outputDirectory: context.outputDirectory, planPath, plan },
    [
      `[demo-recorder] Verified draft plan saved: ${planPath}`,
      `[demo-recorder] Steps: ${plan.capture.steps.length}`,
    ],
  );
  return planPath;
}

async function verifyCommand(context: SessionCommandContext): Promise<string> {
  const request = explorationVerificationRequestSchema.parse(
    await readRequiredJson(context.arguments, "verify", "path.json"),
  );
  const verification = await verifyInteractiveSession(sessionRoot, context.id, request);
  printJsonOrHuman(
    context.arguments,
    {
      ok: verification.status === "passed",
      sessionId: context.id,
      outputDirectory: context.outputDirectory,
      verification,
    },
    verificationLines(verification),
  );
  if (verification.status !== "passed")
    throw new Error(verification.error ?? `Verification failed: ${verification.id}`);
  return verification.artifacts.report;
}

async function actCommand(context: SessionCommandContext): Promise<string> {
  const action = explorationActionSchema.parse(
    await readRequiredJson(context.arguments, "act", "action.json"),
  );
  const { transition, observation } = await actAndObserveInteractiveSession(
    sessionRoot,
    context.id,
    action,
  );
  printJsonOrHuman(
    context.arguments,
    {
      ok: true,
      sessionId: context.id,
      outputDirectory: context.outputDirectory,
      transition,
      observation: summarizeExplorationObservation(observation),
    },
    [...transitionLines(transition), ...observationLines(observation)],
  );
  return observation.artifacts.observation;
}

async function finishCommand(context: SessionCommandContext, abort: boolean): Promise<string> {
  const report = await finishInteractiveSession(sessionRoot, context.id, abort);
  printJsonOrHuman(
    context.arguments,
    { ok: true, sessionId: context.id, outputDirectory: context.outputDirectory, report },
    reportLines(report),
  );
  return context.id;
}

async function statusCommand(context: SessionCommandContext): Promise<string> {
  const report = await interactiveSessionStatus(sessionRoot, context.id);
  printJsonOrHuman(
    context.arguments,
    { ok: true, sessionId: context.id, outputDirectory: context.outputDirectory, report },
    reportLines(report),
  );
  return context.id;
}

const sessionCommandHandlers: Record<SessionOperation, SessionCommandHandler> = {
  observe: observeCommand,
  current: currentCommand,
  find: findCommand,
  act: actCommand,
  verify: verifyCommand,
  "export-plan": exportPlanCommand,
  finish: (context) => finishCommand(context, false),
  abort: (context) => finishCommand(context, true),
  status: statusCommand,
};

async function listSessionsCommand(arguments_: ParsedArguments): Promise<string> {
  const sessions = await listInteractiveSessions(sessionRoot);
  printJsonOrHuman(
    arguments_,
    { ok: true, sessions },
    sessions.length > 0 ? sessions : ["No active exploration sessions"],
  );
  return sessionRoot;
}

export async function interactiveExploreCommand(
  operation: InteractiveExploreOperation,
  arguments_: ParsedArguments,
): Promise<string> {
  if (operation === "start") return startCommand(arguments_);

  const id = stringOption(arguments_, "session") ?? arguments_.positionals[1];
  if (operation === "status" && !id) return listSessionsCommand(arguments_);
  if (!id) throw new Error(`explore ${operation} requires a session ID`);

  const outputDirectory = await interactiveSessionDirectory(sessionRoot, id);
  return sessionCommandHandlers[operation]({ arguments: arguments_, id, outputDirectory });
}
