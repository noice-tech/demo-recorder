import { resolve } from "node:path";
import { explorationActionSchema, type ExplorationAction } from "@noice-tech/demo-recorder-core";
import { selectDriver } from "../driver/index.js";
import { act, PolicyError } from "../session/act.js";
import { observe, type Observation } from "../session/observe.js";
import {
  DEFAULT_LIMITS,
  MAX_DURATION_MS,
  clearSessionFile,
  connectSession,
  loadSessionFile,
  nextObservationId,
  saveSessionFile,
  sessionPath,
  type SessionFile,
} from "../session/session.js";
import {
  booleanOption,
  dimensionsOption,
  nonNegativeNumberOption,
  requireStringOption,
  stringOption,
  type OptionDefinitions,
  type ParsedArguments,
} from "../support/args.js";
import { exists, readJson } from "../support/files.js";

export const exploreOptions: OptionDefinitions = {
  project: { type: "string" },
  url: { type: "string" },
  driver: { type: "string" },
  headed: { type: "boolean" },
  viewport: { type: "string" },
  policy: { type: "string" },
  "storage-state": { type: "string" },
  attached: { type: "boolean" },
  target: { type: "string" },
  page: { type: "string" },
  "idle-timeout": { type: "string" },
  "max-duration": { type: "string" },
  "max-actions": { type: "string" },
  input: { type: "string" },
};

function projectOf(args: ParsedArguments): string {
  return resolve(stringOption(args, "project") ?? ".");
}

function viewportOf(args: ParsedArguments): { width: number; height: number } {
  return dimensionsOption(args, "viewport") ?? { width: 1440, height: 900 };
}

function policyOf(args: ParsedArguments): "read-only" | "reversible" {
  const value = stringOption(args, "policy") ?? "read-only";
  if (value !== "read-only" && value !== "reversible") {
    throw new Error("--policy must be read-only or reversible");
  }
  return value;
}

function summarizeSession(file: SessionFile) {
  return {
    id: file.id,
    driver: file.browser.driver,
    mode: file.browser.mode,
    owned: file.browser.owned,
    policy: file.policy,
    viewport: file.viewport,
    limits: file.limits,
    actions: file.actions,
    lastObservationId: file.lastObservationId,
  };
}

function summarizeObservation(observation: Observation) {
  return {
    id: observation.id,
    url: observation.url,
    title: observation.title,
    viewport: observation.viewport,
    scroll: observation.scroll,
    headings: observation.headings,
    elements: observation.elements.map((element) => ({
      ref: element.ref,
      role: element.role,
      name: element.name,
      enabled: element.enabled,
      visible: element.visible,
      bounds: element.bounds,
      risk: element.risk,
      target: element.target,
    })),
    errors: observation.errors,
    artifacts: observation.artifacts,
  };
}

async function connectExisting(project: string) {
  const file = await loadSessionFile(project);
  const { session } = await connectSession(project, file);
  return { file, session };
}

export async function exploreStart(args: ParsedArguments): Promise<unknown> {
  const project = projectOf(args);
  const driver = selectDriver(stringOption(args, "driver") ?? "playwright");
  const viewport = viewportOf(args);
  const policy = policyOf(args);
  const storageStatePath = stringOption(args, "storage-state");
  const url = stringOption(args, "url");
  const limits = {
    idleTimeoutMs: nonNegativeNumberOption(args, "idle-timeout") ?? DEFAULT_LIMITS.idleTimeoutMs,
    maxDurationMs: Math.min(
      nonNegativeNumberOption(args, "max-duration") ?? DEFAULT_LIMITS.maxDurationMs,
      MAX_DURATION_MS,
    ),
    maxActions: nonNegativeNumberOption(args, "max-actions") ?? DEFAULT_LIMITS.maxActions,
  };

  if (await exists(sessionPath(project))) {
    const live = await loadSessionFile(project)
      .then((file) => connectSession(project, file))
      .catch(() => undefined);
    if (live) throw new Error("A live explore session already exists for this project");
    await clearSessionFile(project);
  }

  const attached = booleanOption(args, "attached") || stringOption(args, "target") !== undefined;
  const requestedPage = stringOption(args, "page");
  const session = attached
    ? await driver.connect({
        mode: "attached",
        headless: false,
        viewport,
        target: requireStringOption(args, "target"),
        ...(requestedPage ? { pageId: requestedPage } : {}),
      })
    : await driver.connect({
        mode: "launched",
        headless: !booleanOption(args, "headed"),
        viewport,
        persistent: true,
        touchFile: sessionPath(project),
        idleTimeoutMs: limits.idleTimeoutMs,
        maxDurationMs: limits.maxDurationMs,
        ...(storageStatePath ? { storageStatePath } : {}),
      });

  let page = requestedPage;
  if (attached) {
    const pages = await session.listPages();
    if (!page) {
      if (pages.length === 0) throw new Error("The attached browser has no open tabs");
      if (pages.length > 1) {
        throw new Error(
          `The attached browser has ${pages.length} tabs; select one with --page (see \`explore pages\`)`,
        );
      }
      page = pages[0]?.id;
      if (page) await session.selectPage(page);
    }
  }

  if (url) await session.goto(url);
  const observation = await observe({ project, session, viewport, id: "obs-0001" });
  const file: SessionFile = {
    version: 1,
    id: `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${Math.random().toString(16).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
    browser: {
      driver: driver.name,
      mode: attached ? "attached" : "launched",
      target: session.target,
      owned: !attached,
      ...(session.pid === undefined ? {} : { pid: session.pid }),
    },
    policy,
    viewport,
    ...(page === undefined ? {} : { page }),
    limits,
    lastObservationId: observation.id,
    actions: 0,
  };
  await saveSessionFile(project, file);
  return { session: summarizeSession(file), observation: summarizeObservation(observation) };
}

export async function explorePages(args: ParsedArguments): Promise<unknown> {
  const target = stringOption(args, "target");
  if (target) {
    const driver = selectDriver(stringOption(args, "driver") ?? "cdp");
    if (!driver.listPages) {
      throw new Error(`Driver "${driver.name}" does not support attached tab discovery`);
    }
    return { pages: await driver.listPages(target) };
  }
  const project = projectOf(args);
  const { file, session } = await connectExisting(project);
  const pages = await session.listPages();
  await saveSessionFile(project, file);
  return { pages };
}

export async function exploreObserve(args: ParsedArguments): Promise<unknown> {
  const project = projectOf(args);
  const { file, session } = await connectExisting(project);
  const id = nextObservationId(file.lastObservationId);
  const observation = await observe({ project, session, viewport: file.viewport, id });
  const updated = { ...file, lastObservationId: observation.id };
  await saveSessionFile(project, updated);
  return { session: summarizeSession(updated), observation: summarizeObservation(observation) };
}

export async function exploreAct(args: ParsedArguments): Promise<unknown> {
  const project = projectOf(args);
  const inputPath = requireStringOption(args, "input");
  const action: ExplorationAction = explorationActionSchema.parse(await readJson(inputPath));
  const { file, session } = await connectExisting(project);
  if (!file.lastObservationId) throw new Error("The session has no observation to act on");
  const id = nextObservationId(file.lastObservationId);

  try {
    const result = await act({
      project,
      session,
      policy: file.policy,
      lastObservationId: file.lastObservationId,
      nextObservationId: id,
      action,
      viewport: file.viewport,
    });
    const updated = { ...file, lastObservationId: id, actions: file.actions + 1 };
    await saveSessionFile(project, updated);
    return {
      recordable: result.recordable,
      target: result.target,
      risk: result.risk,
      reason: result.reason,
      session: summarizeSession(updated),
      observation: summarizeObservation(result.observation),
    };
  } catch (error) {
    if (error instanceof PolicyError) {
      throw new Error(`Blocked by policy: ${error.reason}`, { cause: error });
    }
    throw error;
  }
}

export async function exploreFinish(args: ParsedArguments): Promise<unknown> {
  const project = projectOf(args);
  const file = await loadSessionFile(project).catch(() => undefined);
  if (!file) return { closed: false, message: "No live session to finish" };

  const closed = file.browser.owned;
  const connected = await connectSession(project, file).catch(() => undefined);
  if (closed && file.browser.pid !== undefined) {
    try {
      process.kill(file.browser.pid, "SIGTERM");
    } catch {
      // The browser process is already gone.
    }
  } else if (connected && closed) {
    await connected.session.close();
  }
  await clearSessionFile(project);
  return {
    closed,
    driver: file.browser.driver,
    mode: file.browser.mode,
    actions: file.actions,
    lastObservationId: file.lastObservationId,
  };
}
