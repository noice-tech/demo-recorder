import { readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
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
let acceptingRequests = true;
let watchdog: NodeJS.Timeout | undefined;
let server: ReturnType<typeof createServer> | undefined;
let requestQueue: Promise<void> = Promise.resolve();
const startupAbort = new AbortController();

// A session owns one mutable Playwright page. Queue every page operation so concurrent HTTP
// requests cannot observe or modify the page midway through another command.
async function serialize<T>(operation: () => Promise<T> | T): Promise<T> {
  const result = requestQueue.then(operation, operation);
  requestQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function requireSession(): InteractiveExplorationSession {
  if (!session) throw new Error("Exploration session has not started");
  return session;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
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
  acceptingRequests = false;
  startupAbort.abort();
  if (watchdog) clearTimeout(watchdog);
  await session?.close(status).catch(() => undefined);
  await managedApp?.close().catch(() => undefined);
  await Promise.all([rm(sessionDescriptorPath, { force: true }), rm(configPath, { force: true })]);
}

type CommandRoute = {
  responseKey: string;
  run: (activeSession: InteractiveExplorationSession, request: IncomingMessage) => Promise<unknown>;
};

const commandRoutes: Record<string, CommandRoute> = {
  "/observe": {
    responseKey: "observation",
    run: (activeSession) => activeSession.observe("agent-request"),
  },
  "/act": {
    responseKey: "transition",
    run: async (activeSession, request) => activeSession.act(await readJson(request)),
  },
  "/find": {
    responseKey: "result",
    run: async (activeSession, request) => activeSession.find(await readJson(request)),
  },
  "/verify": {
    responseKey: "verification",
    run: async (activeSession, request) => activeSession.verify(await readJson(request)),
  },
  "/export-plan": {
    responseKey: "plan",
    run: async (activeSession, request) => activeSession.exportPlan(await readJson(request)),
  },
};

async function finishSession(request: IncomingMessage, response: ServerResponse): Promise<void> {
  acceptingRequests = false;
  const status = request.url === "/finish" ? "finished" : "aborted";
  const report = await serialize(async () => {
    const value = requireSession().report(status);
    await cleanup(status);
    return value;
  });
  sendJson(response, 200, { ok: true, report });
  setImmediate(() => server?.close());
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.headers.authorization !== `Bearer ${bearerToken}`) {
    sendJson(response, 403, { ok: false, error: "Forbidden" });
    return;
  }

  try {
    if (request.method === "GET" && request.url === "/status") {
      sendJson(response, 200, { ok: true, report: requireSession().report() });
      return;
    }
    if (!acceptingRequests) {
      sendJson(response, 409, { ok: false, error: "Session is stopping" });
      return;
    }
    if (request.method === "POST" && (request.url === "/finish" || request.url === "/abort")) {
      await finishSession(request, response);
      return;
    }

    const route = request.method === "POST" ? commandRoutes[request.url ?? ""] : undefined;
    if (!route) {
      sendJson(response, 404, { ok: false, error: "Not found" });
      return;
    }
    const result = await serialize(() => route.run(requireSession(), request));
    sendJson(response, 200, { ok: true, [route.responseKey]: result });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const stopOnSignal = (signal: NodeJS.Signals) => {
  startupAbort.abort();
  void cleanup("aborted").finally(() => {
    server?.close();
    process.exitCode = signal === "SIGINT" ? 130 : 143;
  });
};
process.once("SIGINT", () => stopOnSignal("SIGINT"));
process.once("SIGTERM", () => stopOnSignal("SIGTERM"));

try {
  if (config.startCommand) {
    if (!config.repositoryPath)
      throw new Error("Managed exploration start requires a repository path");
    managedApp = await startManagedApp({
      command: config.startCommand,
      cwd: config.repositoryPath,
      readinessUrl: config.readinessUrl ?? config.baseUrl,
      signal: startupAbort.signal,
    });
  }

  session = new InteractiveExplorationSession(config);
  const initialObservation = await session.start();
  const activeServer = createServer(handleRequest);
  server = activeServer;
  await new Promise<void>((resolve, reject) => {
    activeServer.once("error", reject);
    activeServer.listen(0, "127.0.0.1", resolve);
  });

  const address = activeServer.address();
  if (!address || typeof address === "string")
    throw new Error("Exploration daemon has no TCP address");
  watchdog = setTimeout(() => {
    void serialize(() => cleanup("aborted")).finally(() => activeServer.close());
  }, config.maxDurationMs + 30_000);
  watchdog.unref();

  // The client treats descriptor creation, which happens only after listen(), as readiness.
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
} catch (error) {
  await cleanup("failed");
  throw error;
}
