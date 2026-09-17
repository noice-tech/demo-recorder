#!/usr/bin/env node

import { backgroundPresetNames, type BackgroundOptions } from "@noice-tech/demo-recorder-core";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  exploreAct,
  exploreFinish,
  exploreObserve,
  exploreOptions,
  explorePages,
  exploreStart,
} from "./commands/explore.js";
import { runBrowserServer } from "./driver/runtime.js";
import {
  authOptions,
  authList,
  authRemove,
  authSave,
  authStart,
  authStop,
  authVerify,
} from "./commands/auth.js";
import { runDoctor } from "./commands/doctor.js";
import { inspectOptions, runInspect } from "./commands/inspect.js";
import { recordOptions, runRecord } from "./commands/record.js";
import { planRehearse, planShow, planValidate, rehearseOptions } from "./commands/rehearse.js";
import { runSetup, setupOptions } from "./commands/setup.js";
import { renderRecording } from "./commands/render.js";
import {
  booleanOption,
  dimensionsOption,
  nonNegativeNumberOption,
  parseArguments,
  requireStringOption,
  stringOption,
  type OptionDefinitions,
  type ParsedArguments,
} from "./support/args.js";
import { cliVersion } from "./version.js";

function usage(): string {
  return [
    "Usage:",
    "  demo-recorder explore start --url URL [--project DIR] [--driver NAME] [--headed] [--viewport WxH] [--policy read-only|reversible]",
    "  demo-recorder explore pages [--project DIR | --driver cdp --target URL]",
    "  demo-recorder explore observe [--project DIR]",
    "  demo-recorder explore act --input FILE [--project DIR]",
    "  demo-recorder explore finish [--project DIR]",
    "  demo-recorder plan rehearse [plan.json] [--project DIR] [--headed] [--storage-state FILE]",
    "  demo-recorder record [plan.json] [--project DIR] [--allow-unguarded] [--skip-rehearsal] [--headed] [--storage-state FILE] [--output FILE]",
    "  demo-recorder inspect <video> [--contact-sheet] [--output FILE]",
    "  demo-recorder doctor",
    "  demo-recorder setup --chromium --accept-downloads",
    "  demo-recorder auth start|save|remove [--project DIR]",
    "  demo-recorder render [recording] [--project DIR] [--output FILE] [--overwrite] [--aspect-ratio RATIO | --size WxH] [--padding PX] [--padding-mode minimum|exact] [--background preset:NAME|#RRGGBB]",
  ].join("\n");
}

const renderOptions: OptionDefinitions = {
  project: { type: "string" },
  output: { type: "string" },
  "aspect-ratio": { type: "string" },
  size: { type: "string" },
  padding: { type: "string" },
  "padding-mode": { type: "string" },
  background: { type: "string" },
  overwrite: { type: "boolean" },
};

const serverOptions: OptionDefinitions = {
  viewport: { type: "string" },
  "ready-file": { type: "string" },
  "touch-file": { type: "string" },
  "idle-timeout": { type: "string" },
  "max-duration": { type: "string" },
  "storage-state": { type: "string" },
  headless: { type: "boolean" },
};

function backgroundOption(value: string | undefined): BackgroundOptions | undefined {
  if (!value) return undefined;
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return { type: "color", color: value };
  const preset = backgroundPresetNames.find((name) => value === `preset:${name}`);
  if (preset) return { type: "preset", name: preset };
  throw new Error(`--background must be #RRGGBB or preset:${backgroundPresetNames.join("|")}`);
}

async function runRender(rest: string[]): Promise<unknown> {
  const parsed = parseArguments(rest, renderOptions);
  const size = dimensionsOption(parsed, "size");
  const aspectRatio = stringOption(parsed, "aspect-ratio");
  if (size && aspectRatio) throw new Error("Use either --aspect-ratio or --size, not both");
  const padding = nonNegativeNumberOption(parsed, "padding");
  const paddingMode = stringOption(parsed, "padding-mode");
  if (paddingMode && !["minimum", "exact"].includes(paddingMode)) {
    throw new Error("--padding-mode must be minimum or exact");
  }
  const background = backgroundOption(stringOption(parsed, "background"));
  const project = stringOption(parsed, "project");
  const output = stringOption(parsed, "output");
  return renderRecording(parsed.positionals[0], {
    ...(project ? { project } : {}),
    ...(output ? { output } : {}),
    overwrite: booleanOption(parsed, "overwrite"),
    ...size,
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(padding !== undefined ? { padding } : {}),
    ...(paddingMode ? { paddingMode: paddingMode as "minimum" | "exact" } : {}),
    ...(background ? { background } : {}),
  });
}

async function runExplore(rest: string[]): Promise<unknown> {
  const [subcommand, ...subRest] = rest;
  const parsed = parseArguments(subRest, exploreOptions);
  switch (subcommand) {
    case "start":
      return exploreStart(parsed);
    case "pages":
      return explorePages(parsed);
    case "observe":
      return exploreObserve(parsed);
    case "act":
      return exploreAct(parsed);
    case "finish":
      return exploreFinish(parsed);
    default:
      throw new Error(`Unknown explore subcommand: ${subcommand ?? "(missing)"}\n${usage()}`);
  }
}

async function runPlan(rest: string[]): Promise<unknown> {
  const [subcommand, ...subRest] = rest;
  const parsed = parseArguments(subRest, rehearseOptions);
  switch (subcommand) {
    case "rehearse":
      return planRehearse(parsed);
    case "validate":
      console.error("[demo-recorder] `plan validate` is deprecated; use `plan rehearse`");
      return planValidate(parsed);
    case "show":
      console.error("[demo-recorder] `plan show` is deprecated; read plan.json directly");
      return planShow(parsed);
    default:
      throw new Error(`Unknown plan subcommand: ${subcommand ?? "(missing)"}\n${usage()}`);
  }
}

async function runAuth(rest: string[]): Promise<unknown> {
  const [subcommand, ...subRest] = rest;
  const parsed = parseArguments(subRest, authOptions);
  switch (subcommand) {
    case "start":
      return authStart(parsed);
    case "save":
      return authSave(parsed);
    case "remove":
      return authRemove(parsed);
    case "verify":
      console.error("[demo-recorder] `auth verify` is deprecated; use `auth save`");
      return authVerify(parsed);
    case "stop":
      console.error("[demo-recorder] `auth stop` is deprecated; run `auth save` first");
      return authStop(parsed);
    case "list":
      console.error("[demo-recorder] `auth list` is deprecated; use `auth verify`");
      return authList(parsed);
    default:
      throw new Error(`Unknown auth subcommand: ${subcommand ?? "(missing)"}\n${usage()}`);
  }
}

async function runBrowserServerCommand(rest: string[]): Promise<unknown> {
  const parsed: ParsedArguments = parseArguments(rest, serverOptions);
  const readyFile = requireStringOption(parsed, "ready-file");
  const storageStatePath = stringOption(parsed, "storage-state");
  await runBrowserServer({
    viewport: dimensionsOption(parsed, "viewport") ?? { width: 1440, height: 900 },
    headless: booleanOption(parsed, "headless"),
    readyFile,
    touchFile: stringOption(parsed, "touch-file") ?? readyFile,
    idleTimeoutMs: nonNegativeNumberOption(parsed, "idle-timeout") ?? 300_000,
    maxDurationMs: nonNegativeNumberOption(parsed, "max-duration") ?? 1_200_000,
    ...(storageStatePath ? { storageStatePath } : {}),
  });
  return undefined;
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

export async function runCli(arguments_: string[]): Promise<void> {
  const cleaned = arguments_.filter((argument) => argument !== "--json");
  let command = cleaned[0];
  let rest = cleaned.slice(1);
  if (command === "run") {
    console.error("[demo-recorder] `run` is deprecated; use `record`");
    command = "record";
  }
  if (command === "explore" && rest[0]?.startsWith("--")) {
    console.error("[demo-recorder] `explore --url` is deprecated; use `explore start --url`");
    rest = ["start", ...rest];
  }
  if (["--help", "-h", "help"].includes(command ?? "")) {
    console.log(usage());
    return;
  }
  if (["--version", "-v", "version"].includes(command ?? "")) {
    console.log(cliVersion);
    return;
  }

  let result: unknown;
  switch (command) {
    case "render":
      result = await runRender(rest);
      break;
    case "explore":
      result = await runExplore(rest);
      break;
    case "plan":
      result = await runPlan(rest);
      break;
    case "record":
      result = await runRecord(parseArguments(rest, recordOptions));
      break;
    case "inspect":
      result = await runInspect(parseArguments(rest, inspectOptions));
      break;
    case "doctor":
      result = await runDoctor();
      break;
    case "setup":
      result = await runSetup(parseArguments(rest, setupOptions));
      break;
    case "auth":
      result = await runAuth(rest);
      break;
    case "__browser-server":
      result = await runBrowserServerCommand(rest);
      break;
    default:
      throw new Error(`${command ? `Unknown command: ${command}` : "Missing command"}\n${usage()}`);
  }

  if (result !== undefined) console.log(JSON.stringify(result, null, 2));
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
  runCli(process.argv.slice(2))
    .then(() => {
      // A connected Playwright client keeps the event loop alive; exit once output drains.
      process.stdout.write("", () => process.exit(0));
      setTimeout(() => process.exit(0), 1_000);
    })
    .catch((error: unknown) => {
      console.error(`[demo-recorder] ${formatError(error)}`);
      process.exit(1);
    });
}
