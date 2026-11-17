import { execFile } from "node:child_process";
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

export type Observation = { id: string; snapshot: string; scroll: { x: number; y: number } };

/** Runs one CLI command in its own process, as an agent does. */
export async function cli<Result>(...args: string[]): Promise<Result> {
  try {
    const { stdout } = await execute(process.execPath, ["--import", "tsx", cliEntry, ...args], {
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(stdout) as Result;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? "";
    throw new Error(stderr.trim() || String(error), { cause: error });
  }
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
    close: () => new Promise((done) => server.close(() => done())),
  };
}

/** Refs the snapshot shows for an element, in page order. */
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
