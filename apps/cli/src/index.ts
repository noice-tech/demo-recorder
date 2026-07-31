#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { authCommand } from "./auth.js";
import {
  numberOption,
  parseArguments,
  stringOption,
  type OptionDefinitions,
  type ParsedArguments,
} from "./arguments.js";
import { doctorCommand, setupCommand } from "./environment.js";
import { exploreCommand } from "./explore.js";
import { inspectVideoCommand } from "./inspect-video.js";
import { showPlanCommand, validatePlanCommand } from "./plan.js";
import { renderRecording } from "./render.js";
import { rehearsePlanFile } from "./rehearsal.js";
import { recordPlan, runPlan } from "./run-plan.js";
import { updateCommand } from "./updates.js";
import { cliVersion } from "./version.js";

function usage(): string {
  return [
    "Usage:",
    "  demo-recorder doctor [--json]",
    "  demo-recorder setup --chromium [--accept-downloads] [--json]",
    "  demo-recorder update check [--json]",
    "  demo-recorder explore --url URL [--repo PATH --start COMMAND] [--auth PROFILE]",
    "  demo-recorder explore start --url URL [--session ID] [--policy read-only|reversible]",
    "  demo-recorder explore <observe|current|find|act|verify|export-plan|finish|abort|status> [SESSION] [options]",
    "  demo-recorder inspect <video.mp4> [--contact-sheet[=PATH]]",
    "  demo-recorder plan validate <demo-plan.json>",
    "  demo-recorder plan show <demo-plan.json>",
    "  demo-recorder plan rehearse <demo-plan.json> [--attempt 1] [--output PATH]",
    "  demo-recorder record --plan <demo-plan.json> [--headed]",
    "  demo-recorder run <demo-plan.json> [--headed]",
    "  demo-recorder auth <start|save|stop|verify|remove|list> [options]",
    "  demo-recorder render <recording>",
  ].join("\n");
}

export const commandOptions: Record<string, OptionDefinitions> = {
  doctor: { json: { type: "boolean" } },
  setup: {
    chromium: { type: "boolean" },
    "accept-downloads": { type: "boolean" },
    json: { type: "boolean" },
  },
  update: { json: { type: "boolean" } },
  explore: {
    url: { type: "string" },
    repo: { type: "string" },
    start: { type: "string" },
    "readiness-url": { type: "string" },
    output: { type: "string" },
    auth: { type: "string" },
    "max-pages": { type: "string" },
    "max-depth": { type: "string" },
    "max-actions": { type: "string" },
    "max-duration-ms": { type: "string" },
    "allow-cross-origin": { type: "boolean" },
    session: { type: "string" },
    input: { type: "string" },
    text: { type: "string" },
    regex: { type: "string" },
    goal: { type: "string" },
    policy: { type: "string" },
    json: { type: "boolean" },
    headed: { type: "boolean" },
  },
  inspect: { "contact-sheet": { type: "string", optionalValue: true } },
  plan: {
    output: { type: "string" },
    attempt: { type: "string" },
    headed: { type: "boolean" },
    json: { type: "boolean" },
  },
  auth: { profile: { type: "string" }, url: { type: "string" } },
  record: { plan: { type: "string" }, headed: { type: "boolean" } },
  run: { headed: { type: "boolean" } },
  render: {},
  create: {},
};

function requireArgument(value: string | undefined, command: string): string {
  if (!value) throw new Error(`Missing argument for ${command}\n${usage()}`);
  return value;
}

function formatError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const messages: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  return messages.join("\n  caused by: ");
}

async function runPlanCommand(parsed: ReturnType<typeof parseArguments>): Promise<void> {
  const [operation, path] = parsed.positionals;
  if (operation === "validate") return validatePlanCommand(requireArgument(path, "plan validate"));
  if (operation === "show") return showPlanCommand(requireArgument(path, "plan show"));
  if (operation !== "rehearse")
    throw new Error(`Unknown plan operation: ${operation ?? "missing"}\n${usage()}`);

  const rehearsalOutput = stringOption(parsed, "output");
  const result = await rehearsePlanFile({
    planArgument: requireArgument(path, "plan rehearse"),
    ...(rehearsalOutput ? { outputDirectory: rehearsalOutput } : {}),
    attempt: numberOption(parsed, "attempt", 1),
    headless: !parsed.options.has("headed"),
  });
  if (parsed.options.has("json")) {
    console.log(JSON.stringify({ ok: result.report.status === "passed", ...result }, null, 2));
  } else {
    console.log(`[demo-recorder] Rehearsal ${result.report.status}: ${result.report.planName}`);
    console.log(
      `[demo-recorder] Report: ${resolve(result.outputDirectory, result.report.artifacts.report)}`,
    );
    if (result.report.failure)
      console.log(
        `[demo-recorder] Failed at step ${result.report.failure.stepIndex}: ${result.report.failure.error}`,
      );
  }
  if (result.report.status === "failed")
    throw new Error(
      `Plan rehearsal failed at step ${result.report.failure?.stepIndex ?? "unknown"}`,
    );
}

type CommandHandler = (parsed: ParsedArguments) => unknown | Promise<unknown>;

function runAuthCommand(parsed: ParsedArguments): Promise<void> {
  const [operation, ...positionals] = parsed.positionals;
  return authCommand(operation, { ...parsed, positionals });
}

function runRecordCommand(parsed: ParsedArguments): Promise<unknown> {
  const plan = stringOption(parsed, "plan");
  if (!plan) throw new Error(`Missing --plan for record\n${usage()}`);
  return recordPlan(plan, { headless: !parsed.options.has("headed") });
}

const commandHandlers = new Map<string, CommandHandler>([
  ["doctor", doctorCommand],
  ["setup", setupCommand],
  ["update", updateCommand],
  ["explore", (parsed) => exploreCommand(parsed)],
  [
    "inspect",
    (parsed) => inspectVideoCommand(requireArgument(parsed.positionals[0], "inspect"), parsed),
  ],
  ["plan", runPlanCommand],
  ["auth", runAuthCommand],
  ["record", runRecordCommand],
  [
    "run",
    (parsed) =>
      runPlan(requireArgument(parsed.positionals[0], "run"), {
        headless: !parsed.options.has("headed"),
      }),
  ],
  ["render", (parsed) => renderRecording(requireArgument(parsed.positionals[0], "render"))],
  [
    "create",
    () => {
      throw new Error(
        "`create` is an agent workflow, not an embedded model command. Ask your coding agent to load the demo-video skill, explore the target, write a plan, and run it.",
      );
    },
  ],
]);

export async function runCli(arguments_: string[]): Promise<void> {
  const [command, ...rest] = arguments_;
  if (["--help", "-h", "help"].includes(command ?? "")) {
    console.log(usage());
    return;
  }
  if (["--version", "-v", "version"].includes(command ?? "")) {
    console.log(cliVersion);
    return;
  }

  const commandName = command ?? "";
  const parsed = parseArguments(rest, commandOptions[commandName] ?? {});
  const handler = commandHandlers.get(commandName);
  if (!handler)
    throw new Error(`${command ? `Unknown command: ${command}` : "Missing command"}\n${usage()}`);
  await handler(parsed);
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(`[demo-recorder] ${formatError(error)}`);
    process.exitCode = 1;
  });
}
