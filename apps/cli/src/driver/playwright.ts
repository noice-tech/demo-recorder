import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { chromium, type Browser } from "playwright";
import { createBrowserSession, selectPage } from "./browser-session.js";
import type { Capability, ConnectOptions, Driver, Session } from "./types.js";

const capabilities: ReadonlySet<Capability> = new Set<Capability>([
  "launch",
  "ownLifecycle",
  "isolatedContext",
  "authState",
  "capture",
  "guarded",
]);

const HIDE_CURSOR_SCRIPT =
  "(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{cursor:none !important}'; (document.head || document.documentElement).append(s); })();";

async function startServer(options: ConnectOptions): Promise<{ endpoint: string; pid?: number }> {
  const runtimeDirectory = await mkdtemp(join(tmpdir(), "demo-recorder-session-"));
  const readyFile = join(runtimeDirectory, "ready.json");
  const entry = process.argv[1];
  if (!entry) throw new Error("Unable to determine the CLI entry point");
  const idleTimeoutMs = options.idleTimeoutMs ?? 300_000;
  const maxDurationMs = options.maxDurationMs ?? 1_200_000;
  const child = spawn(
    process.execPath,
    [
      ...process.execArgv,
      entry,
      "__browser-server",
      "--viewport",
      `${options.viewport.width}x${options.viewport.height}`,
      "--ready-file",
      readyFile,
      "--touch-file",
      options.touchFile ?? readyFile,
      "--idle-timeout",
      String(idleTimeoutMs),
      "--max-duration",
      String(maxDurationMs),
      ...(options.headless ? ["--headless"] : []),
      ...(options.storageStatePath ? ["--storage-state", options.storageStatePath] : []),
    ],
    { detached: true, stdio: "ignore" },
  );
  child.unref();

  const deadline = Date.now() + 60_000;
  while (Date.now() <= deadline) {
    const ready = await readFile(readyFile, "utf8").then(
      (text) => JSON.parse(text) as { endpoint?: string; pid?: number; error?: string },
      () => undefined,
    );
    if (ready?.error) throw new Error(`Browser server failed to start: ${ready.error}`);
    if (ready?.endpoint) {
      return ready.pid === undefined
        ? { endpoint: ready.endpoint }
        : { endpoint: ready.endpoint, pid: ready.pid };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Timed out waiting for the browser server to start");
}

export async function connectTo(target: string): Promise<Browser> {
  return target.startsWith("http")
    ? chromium.connectOverCDP(target, { timeout: 30_000 })
    : chromium.connect(target, { timeout: 30_000 });
}

export const playwrightDriver: Driver = {
  name: "playwright-chromium",
  capabilities,
  async connect(options: ConnectOptions): Promise<Session> {
    if (options.mode === "attached") {
      throw new Error('Driver "playwright-chromium" does not support the "attach" capability');
    }

    let browser: Browser;
    let connectionTarget = options.target ?? "";
    let connectionPid: number | undefined;
    if (options.target) {
      browser = await connectTo(options.target);
    } else if (options.persistent) {
      const server = await startServer(options);
      connectionTarget = server.endpoint;
      connectionPid = server.pid;
      browser = await connectTo(connectionTarget);
    } else {
      browser = await chromium.launch({ headless: options.headless });
      connectionTarget = "launched";
    }

    const existing = browser.contexts()[0];
    const context =
      existing ??
      (await browser.newContext({
        viewport: options.viewport,
        acceptDownloads: false,
        ...(options.storageStatePath ? { storageState: options.storageStatePath } : {}),
      }));
    if (!existing) await context.addInitScript({ content: HIDE_CURSOR_SCRIPT });
    const page = await selectPage(context, options.pageId);

    return createBrowserSession({
      browser,
      context,
      page,
      target: connectionTarget,
      viewport: options.viewport,
      ownsLifecycle: true,
      capture: true,
      guarded: !existing,
      ...(connectionPid === undefined ? {} : { pid: connectionPid }),
    });
  },
};
