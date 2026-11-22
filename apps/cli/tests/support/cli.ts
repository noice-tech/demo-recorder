import { execFile, spawn, type ChildProcess } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const cliEntry = fileURLToPath(new URL("../../src/index.ts", import.meta.url));
const fixture = fileURLToPath(new URL("../fixtures/example-app/", import.meta.url));
const contentTypes: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
};

export type Observation = {
  id: string;
  outline: string;
  snapshotFile: string;
  scroll: { x: number; y: number };
};

export class CliError extends Error {
  constructor(
    message: string,
    readonly stdout: string,
    readonly stderr: string,
  ) {
    super(message);
  }
}

/** With `--json`, a failure is reported on stdout instead of stderr. */
function reportedError(stdout: string): string | undefined {
  try {
    const report = JSON.parse(stdout) as { ok?: boolean; error?: string; causes?: string[] };
    if (report.ok !== false || !report.error) return undefined;
    return [report.error, ...(report.causes ?? [])].join("\n  caused by: ");
  } catch {
    return undefined;
  }
}

/** Runs one CLI command in its own process, as an agent does. */
export async function cli<Result>(...args: string[]): Promise<Result> {
  try {
    const { stdout } = await execute(process.execPath, ["--import", "tsx", cliEntry, ...args], {
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(stdout) as Result;
  } catch (error) {
    const { stdout = "", stderr = "" } = error as { stdout?: string; stderr?: string };
    const message = reportedError(stdout) ?? (stderr.trim() || String(error));
    throw new CliError(message, stdout, stderr);
  }
}

/** Starts a CLI command without waiting for it, to stop it midway. */
export function startCli(...args: string[]): ChildProcess {
  return spawn(process.execPath, ["--import", "tsx", cliEntry, ...args], { stdio: "ignore" });
}

/** Runs `explore act` with an action written to the project's input file. */
export async function act<Result>(project: string, action: object): Promise<Result> {
  const input = join(project, "action.json");
  await writeFile(input, JSON.stringify(action));
  return cli<Result>("explore", "act", "--project", project, "--input", input, "--json");
}

/** Serves the example app; returns its base URL and a function that stops it. */
export async function serveFixture(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    // Never answer, like a stalled site.
    if (path.startsWith("/stall/")) return;
    const file = join(fixture, path === "/" ? "index.html" : path);
    readFile(file).then(
      (body) => {
        response.writeHead(200, { "content-type": contentTypes[extname(file)] ?? "text/plain" });
        response.end(body);
      },
      () => {
        response.writeHead(404);
        response.end();
      },
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No server address");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

/** Refs an outline or snapshot shows for an element, in page order. */
export function refsOf(snapshot: string, element: string): string[] {
  return snapshot
    .split("\n")
    .filter((line) => line.includes(`- ${element} `) || line.endsWith(`- ${element}`))
    .map((line) => /\[ref=([^\]]+)\]/.exec(line)?.[1])
    .filter((ref): ref is string => ref !== undefined);
}

export function refOf(snapshot: string, element: string): string {
  const [ref] = refsOf(snapshot, element);
  if (!ref) throw new Error(`No ref for ${element} in:\n${snapshot}`);
  return ref;
}
