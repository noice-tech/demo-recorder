import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  actInInteractiveSession,
  authProfilePaths,
  explorationActionSchema,
  explorationPolicySchema,
  explorationVerificationRequestSchema,
  exploreSite,
  findInInteractiveSession,
  finishInteractiveSession,
  inspectRepository,
  interactiveSessionDirectory,
  interactiveSessionStatus,
  listInteractiveSessions,
  observeInteractiveSession,
  startInteractiveSession,
  startManagedApp,
  verifyInteractiveSession,
  type ExplorationObservation,
  type ExplorationSessionReport,
  type ExplorationTransition,
  type ExplorationVerificationReport,
} from "./explorer/index.js";
import { numberOption, stringOption, type ParsedArguments } from "./arguments.js";
import { workingDirectory } from "./paths.js";

function generatedId(prefix: string): string {
  return `${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}-${prefix}-${randomUUID().slice(0, 8)}`;
}

function resolveWorkingPath(path: string): string {
  return isAbsolute(path) ? path : resolve(workingDirectory, path);
}

const interactiveSessionRoot = join(workingDirectory, ".demo-recorder/explorations/.sessions");

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
  for (const element of observation.interactiveElements.slice(0, 30)) {
    lines.push(
      `[${element.ref}] ${element.role ?? element.tagName.toLowerCase()} ${JSON.stringify(element.name)} — ${element.risk}${element.enabled ? "" : " (disabled)"}`,
    );
  }
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

async function interactiveExploreCommand(
  operation: string,
  arguments_: ParsedArguments,
): Promise<string> {
  if (operation === "start") {
    const url = stringOption(arguments_, "url");
    if (!url) throw new Error("explore start requires --url <http-or-https-url>");
    const repositoryPath = stringOption(arguments_, "repo");
    const resolvedRepository = repositoryPath
      ? resolve(workingDirectory, repositoryPath)
      : undefined;
    const startCommand = stringOption(arguments_, "start");
    if (startCommand && !resolvedRepository)
      throw new Error("--start requires --repo so the command has an explicit working directory");
    const id = stringOption(arguments_, "session") ?? generatedId("interactive");
    const outputDirectory = resolveWorkingPath(
      stringOption(arguments_, "output") ??
        join(workingDirectory, ".demo-recorder/explorations", id),
    );
    const authProfile = stringOption(arguments_, "auth");
    const authPaths = authProfile
      ? authProfilePaths(join(workingDirectory, ".demo-recorder/auth"), authProfile)
      : undefined;
    const policy = explorationPolicySchema.parse(stringOption(arguments_, "policy") ?? "read-only");
    const { observation } = await startInteractiveSession({
      sessionRoot: interactiveSessionRoot,
      config: {
        version: 1,
        id,
        baseUrl: url,
        outputDirectory,
        headless: !arguments_.options.has("headed"),
        policy,
        maxActions: numberOption(arguments_, "max-actions", 40),
        maxDurationMs: numberOption(arguments_, "max-duration-ms", 5 * 60_000),
        ...(resolvedRepository ? { repositoryPath: resolvedRepository } : {}),
        ...(startCommand ? { startCommand } : {}),
        ...(stringOption(arguments_, "readiness-url")
          ? { readinessUrl: stringOption(arguments_, "readiness-url") }
          : {}),
        ...(authPaths
          ? {
              storageStatePath: authPaths.storageStatePath,
              sessionStoragePath: authPaths.sessionStoragePath,
            }
          : {}),
        ...(authProfile ? { authProfile } : {}),
        ...(stringOption(arguments_, "goal") ? { goal: stringOption(arguments_, "goal") } : {}),
      },
    });
    printJsonOrHuman(arguments_, { ok: true, sessionId: id, outputDirectory, observation }, [
      `[demo-recorder] Exploration session started: ${id}`,
      `[demo-recorder] Output: ${outputDirectory}`,
      ...observationLines(observation),
    ]);
    return outputDirectory;
  }

  const id = stringOption(arguments_, "session") ?? arguments_.positionals[1];
  if (operation === "status" && !id) {
    const sessions = await listInteractiveSessions(interactiveSessionRoot);
    printJsonOrHuman(
      arguments_,
      { ok: true, sessions },
      sessions.length > 0 ? sessions : ["No active exploration sessions"],
    );
    return interactiveSessionRoot;
  }
  if (!id) throw new Error(`explore ${operation} requires a session ID`);
  const outputDirectory = await interactiveSessionDirectory(interactiveSessionRoot, id);

  if (operation === "observe") {
    const observation = await observeInteractiveSession(interactiveSessionRoot, id);
    printJsonOrHuman(arguments_, { ok: true, sessionId: id, outputDirectory, observation }, [
      `[demo-recorder] Output: ${outputDirectory}`,
      ...observationLines(observation),
    ]);
    return observation.artifacts.observation;
  }
  if (operation === "find") {
    const text = stringOption(arguments_, "text");
    const regex = stringOption(arguments_, "regex");
    const result = await findInInteractiveSession(interactiveSessionRoot, id, {
      ...(text ? { text } : {}),
      ...(regex ? { regex } : {}),
    });
    printJsonOrHuman(
      arguments_,
      { ok: true, sessionId: id, outputDirectory, result },
      result.matches.length > 0
        ? result.matches.map(
            (match) =>
              `${match.ref ? `[${match.ref}] ` : ""}${match.role ?? match.kind} ${JSON.stringify(match.text)}${match.risk ? ` — ${match.risk}` : ""}`,
          )
        : ["No matches in the current observation"],
    );
    return id;
  }
  if (operation === "verify") {
    const inputPath = stringOption(arguments_, "input");
    if (!inputPath) throw new Error("explore verify requires --input <path.json>");
    const request = explorationVerificationRequestSchema.parse(
      JSON.parse(await readFile(resolveWorkingPath(inputPath), "utf8")) as unknown,
    );
    const verification = await verifyInteractiveSession(interactiveSessionRoot, id, request);
    printJsonOrHuman(
      arguments_,
      { ok: verification.status === "passed", sessionId: id, outputDirectory, verification },
      verificationLines(verification),
    );
    if (verification.status !== "passed")
      throw new Error(verification.error ?? `Verification failed: ${verification.id}`);
    return verification.artifacts.report;
  }
  if (operation === "act") {
    const inputPath = stringOption(arguments_, "input");
    if (!inputPath) throw new Error("explore act requires --input <action.json>");
    const action = explorationActionSchema.parse(
      JSON.parse(await readFile(resolveWorkingPath(inputPath), "utf8")) as unknown,
    );
    const transition = await actInInteractiveSession(interactiveSessionRoot, id, action);
    printJsonOrHuman(
      arguments_,
      { ok: true, sessionId: id, outputDirectory, transition },
      transitionLines(transition),
    );
    return id;
  }
  if (operation === "finish" || operation === "abort") {
    const report = await finishInteractiveSession(
      interactiveSessionRoot,
      id,
      operation === "abort",
    );
    printJsonOrHuman(
      arguments_,
      { ok: true, sessionId: id, outputDirectory, report },
      reportLines(report),
    );
    return id;
  }
  if (operation === "status") {
    const report = await interactiveSessionStatus(interactiveSessionRoot, id);
    printJsonOrHuman(
      arguments_,
      { ok: true, sessionId: id, outputDirectory, report },
      reportLines(report),
    );
    return id;
  }
  throw new Error(`Unknown explore operation: ${operation}`);
}

export async function exploreCommand(arguments_: ParsedArguments): Promise<string> {
  const operation = arguments_.positionals[0];
  if (
    ["start", "observe", "find", "act", "verify", "finish", "abort", "status"].includes(
      operation ?? "",
    )
  )
    return interactiveExploreCommand(operation!, arguments_);
  const url = stringOption(arguments_, "url");
  if (!url) throw new Error("explore requires --url <http-or-https-url>");
  const repositoryPath = stringOption(arguments_, "repo");
  const resolvedRepository = repositoryPath ? resolve(workingDirectory, repositoryPath) : undefined;
  const startCommand = stringOption(arguments_, "start");
  const readinessUrl = stringOption(arguments_, "readiness-url") ?? url;
  const outputDirectory = resolveWorkingPath(
    stringOption(arguments_, "output") ??
      join(workingDirectory, ".demo-recorder/explorations", generatedId("exploration")),
  );
  const authProfile = stringOption(arguments_, "auth");
  const authPaths = authProfile
    ? authProfilePaths(join(workingDirectory, ".demo-recorder/auth"), authProfile)
    : undefined;
  let managed: Awaited<ReturnType<typeof startManagedApp>> | undefined;
  try {
    if (startCommand) {
      if (!resolvedRepository)
        throw new Error("--start requires --repo so the command has an explicit working directory");
      console.log(`[demo-recorder] Starting managed application: ${startCommand}`);
      managed = await startManagedApp({
        command: startCommand,
        cwd: resolvedRepository,
        readinessUrl,
        log: (line) => process.stdout.write(`[target] ${line}`),
      });
    }
    console.log(`[demo-recorder] Exploring ${url}`);
    const report = await exploreSite({
      baseUrl: url,
      outputDirectory,
      maxPages: numberOption(arguments_, "max-pages", 10),
      maxDepth: numberOption(arguments_, "max-depth", 2),
      sameOriginOnly: !arguments_.options.has("allow-cross-origin"),
      headless: !arguments_.options.has("headed"),
      ...(authPaths
        ? {
            storageStatePath: authPaths.storageStatePath,
            sessionStoragePath: authPaths.sessionStoragePath,
          }
        : {}),
      ...(authProfile ? { authProfile } : {}),
      ...(resolvedRepository ? { repositoryPath: resolvedRepository } : {}),
    });
    console.log(
      `[demo-recorder] Explored ${report.pages.length} page${report.pages.length === 1 ? "" : "s"}`,
    );
    console.log(`[demo-recorder] Exploration saved: ${outputDirectory}`);
    return outputDirectory;
  } finally {
    if (managed) await managed.close();
  }
}

export async function inspectRepositoryCommand(arguments_: ParsedArguments): Promise<string> {
  const repositoryPath = resolve(workingDirectory, stringOption(arguments_, "repo") ?? ".");
  const outputPath = resolveWorkingPath(
    stringOption(arguments_, "output") ?? join(workingDirectory, ".demo-recorder/repository.json"),
  );
  const report = await inspectRepository(repositoryPath);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[demo-recorder] Repository report saved: ${outputPath}`);
  return outputPath;
}
