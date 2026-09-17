import { join, resolve } from "node:path";
import { z } from "zod";
import { selectDriver } from "../driver/index.js";
import {
  booleanOption,
  dimensionsOption,
  stringOption,
  type OptionDefinitions,
  type ParsedArguments,
} from "../support/args.js";
import { readJson, removeFile, writeJsonAtomic } from "../support/files.js";

export const authOptions: OptionDefinitions = {
  project: { type: "string" },
  url: { type: "string" },
  output: { type: "string" },
  driver: { type: "string" },
  headed: { type: "boolean" },
  viewport: { type: "string" },
};

const authSessionSchema = z.object({
  version: z.literal(1),
  createdAt: z.iso.datetime(),
  browser: z.object({
    driver: z.string().min(1),
    target: z.string().min(1),
    pid: z.number().int().optional(),
  }),
});

type AuthSession = z.infer<typeof authSessionSchema>;

function authSessionPath(project: string): string {
  return join(project, ".auth-session.json");
}

export async function authStart(args: ParsedArguments): Promise<unknown> {
  const project = resolve(stringOption(args, "project") ?? ".");
  const driver = selectDriver(stringOption(args, "driver") ?? "playwright");
  const url = stringOption(args, "url");
  const session = await driver.connect({
    mode: "launched",
    headless: !booleanOption(args, "headed"),
    viewport: dimensionsOption(args, "viewport") ?? { width: 1440, height: 900 },
    persistent: true,
    touchFile: authSessionPath(project),
    idleTimeoutMs: 900_000,
    maxDurationMs: 3_600_000,
  });
  if (url) await session.goto(url);

  const file: AuthSession = {
    version: 1,
    createdAt: new Date().toISOString(),
    browser: {
      driver: driver.name,
      target: session.target,
      ...(session.pid === undefined ? {} : { pid: session.pid }),
    },
  };
  await writeJsonAtomic(authSessionPath(project), file);
  return {
    status: "waiting",
    url: url ?? (await session.url()),
    message: "Log in, then run `auth save`",
  };
}

export async function authSave(args: ParsedArguments): Promise<unknown> {
  const project = resolve(stringOption(args, "project") ?? ".");
  const file = authSessionSchema.parse(await readJson(authSessionPath(project)));
  const output = resolve(stringOption(args, "output") ?? join(project, "auth-state.json"));
  const driver = selectDriver(file.browser.driver);
  const session = await driver.connect({
    mode: "launched",
    headless: true,
    viewport: { width: 1440, height: 900 },
    target: file.browser.target,
  });
  await session.saveStorageState(output);
  if (file.browser.pid !== undefined) {
    try {
      process.kill(file.browser.pid, "SIGTERM");
    } catch {
      // The browser process is already gone.
    }
  }
  await removeFile(authSessionPath(project));
  return { saved: output };
}

export async function authRemove(args: ParsedArguments): Promise<unknown> {
  const project = resolve(stringOption(args, "project") ?? ".");
  const output = resolve(stringOption(args, "output") ?? join(project, "auth-state.json"));
  await removeFile(output);
  return { removed: output };
}

/** Deprecated aliases: auth verify | stop | list. */
export async function authVerify(args: ParsedArguments): Promise<unknown> {
  const project = resolve(stringOption(args, "project") ?? ".");
  const path = resolve(stringOption(args, "output") ?? join(project, "auth-state.json"));
  const value = await readJson(path).catch(() => undefined);
  return { valid: value !== undefined, path };
}

export async function authStop(args: ParsedArguments): Promise<unknown> {
  const project = resolve(stringOption(args, "project") ?? ".");
  const file = await readJson(authSessionPath(project)).then(
    (value) => authSessionSchema.parse(value),
    () => undefined,
  );
  if (!file) return { stopped: false, message: "No auth browser is running" };
  if (file.browser.pid !== undefined) {
    try {
      process.kill(file.browser.pid, "SIGTERM");
    } catch {
      // The browser process is already gone.
    }
  }
  await removeFile(authSessionPath(project));
  return { stopped: true };
}

export async function authList(args: ParsedArguments): Promise<unknown> {
  const project = resolve(stringOption(args, "project") ?? ".");
  const output = resolve(stringOption(args, "output") ?? join(project, "auth-state.json"));
  const value = await readJson(output).catch(() => undefined);
  return { states: value === undefined ? [] : [output] };
}
