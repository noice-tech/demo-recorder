import { createServer, type IncomingMessage } from "node:http";
import { readFile, rm, writeFile } from "node:fs/promises";
import { explorationLaunchConfigSchema } from "./interactive-schema.js";
import { InteractiveExplorationSession } from "./interactive-session.js";
import { startManagedApp, type ManagedApp } from "./managed-app.js";

const [launchConfigPath, descriptorPath, token] = process.argv.slice(2);
if (!launchConfigPath || !descriptorPath || !token)
  throw new Error("Invalid exploration daemon arguments");
const configPath = launchConfigPath;
const sessionDescriptorPath = descriptorPath;
const bearerToken = token;

const config = explorationLaunchConfigSchema.parse(
  JSON.parse(await readFile(configPath, "utf8")) as unknown,
);
let managedApp: ManagedApp | undefined;
let session: InteractiveExplorationSession | undefined;
let stopping = false;
let watchdog: NodeJS.Timeout | undefined;
let requestQueue: Promise<void> = Promise.resolve();

async function serialize<T>(operation: () => Promise<T> | T): Promise<T> {
  const result = requestQueue.then(operation, operation);
  requestQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += value.length;
    if (length > 256 * 1024) throw new Error("Request body exceeds 256 KiB");
    chunks.push(value);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

async function cleanup(status: "finished" | "aborted" | "failed"): Promise<void> {
  if (stopping) return;
  stopping = true;
  if (watchdog) clearTimeout(watchdog);
  await session?.close(status).catch(() => undefined);
  await managedApp?.close().catch(() => undefined);
  await Promise.all([rm(sessionDescriptorPath, { force: true }), rm(configPath, { force: true })]);
}

try {
  if (config.startCommand) {
    if (!config.repositoryPath)
      throw new Error("Managed exploration start requires a repository path");
    managedApp = await startManagedApp({
      command: config.startCommand,
      cwd: config.repositoryPath,
      readinessUrl: config.readinessUrl ?? config.baseUrl,
    });
  }
  session = new InteractiveExplorationSession(config);
  const initialObservation = await session.start();

  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.headers.authorization !== `Bearer ${bearerToken}`) {
      response.writeHead(403).end(JSON.stringify({ ok: false, error: "Forbidden" }));
      return;
    }
    try {
      if (request.method === "GET" && request.url === "/status") {
        response.end(JSON.stringify({ ok: true, report: session?.report() }));
        return;
      }
      if (request.method === "POST" && request.url === "/observe") {
        const observation = await serialize(() => session?.observe("agent-request"));
        response.end(JSON.stringify({ ok: true, observation }));
        return;
      }
      if (request.method === "POST" && request.url === "/act") {
        const input = await readJson(request);
        const transition = await serialize(() => session?.act(input));
        response.end(JSON.stringify({ ok: true, transition }));
        return;
      }
      if (request.method === "POST" && request.url === "/find") {
        const input = await readJson(request);
        const result = await serialize(() => session?.find(input));
        response.end(JSON.stringify({ ok: true, result }));
        return;
      }
      if (request.method === "POST" && request.url === "/verify") {
        const input = await readJson(request);
        const verification = await serialize(() => session?.verify(input));
        response.end(JSON.stringify({ ok: true, verification }));
        return;
      }
      if (request.method === "POST" && request.url === "/export-plan") {
        const input = await readJson(request);
        const plan = await serialize(() => session?.exportPlan(input));
        response.end(JSON.stringify({ ok: true, plan }));
        return;
      }
      if (request.method === "POST" && ["/finish", "/abort"].includes(request.url ?? "")) {
        const status = request.url === "/finish" ? "finished" : "aborted";
        const report = session?.report(status);
        await serialize(() => cleanup(status));
        response.end(JSON.stringify({ ok: true, report }));
        setImmediate(() => server.close());
        return;
      }
      response.writeHead(404).end(JSON.stringify({ ok: false, error: "Not found" }));
    } catch (error) {
      response.writeHead(500).end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Exploration daemon has no TCP address");
  watchdog = setTimeout(() => {
    void serialize(() => cleanup("aborted")).finally(() => server.close());
  }, config.maxDurationMs + 30_000);
  watchdog.unref();
  await writeFile(
    sessionDescriptorPath,
    `${JSON.stringify(
      {
        version: 1,
        id: config.id,
        pid: process.pid,
        port: address.port,
        token,
        outputDirectory: config.outputDirectory,
        launchConfigPath,
        initialObservationId: initialObservation.id,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );

  const stopOnSignal = (signal: NodeJS.Signals) => {
    void cleanup("aborted").finally(() => {
      server.close();
      process.exitCode = signal === "SIGINT" ? 130 : 143;
    });
  };
  process.once("SIGINT", () => stopOnSignal("SIGINT"));
  process.once("SIGTERM", () => stopOnSignal("SIGTERM"));
} catch (error) {
  await cleanup("failed");
  throw error;
}
