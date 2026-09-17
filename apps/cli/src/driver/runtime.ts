import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserContext } from "playwright";
import { writeJsonAtomic } from "../support/files.js";

export type BrowserServerOptions = {
  viewport: { width: number; height: number };
  headless: boolean;
  readyFile: string;
  touchFile: string;
  idleTimeoutMs: number;
  maxDurationMs: number;
  storageStatePath?: string;
};

const HIDE_CURSOR_SCRIPT =
  "(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{cursor:none !important}'; (document.head || document.documentElement).append(s); })();";

const POLL_INTERVAL_MS = 2_000;

async function touchState(path: string): Promise<{ mtimeMs: number; exists: boolean }> {
  const value = await stat(path).catch(() => undefined);
  return { mtimeMs: value?.mtimeMs ?? Date.now(), exists: Boolean(value) };
}

/**
 * Hosts one Chromium with a CDP endpoint so an explore session outlives a
 * single CLI command and every command shares the same tabs and page state.
 * It ends itself when the session file stops being touched or the maximum
 * duration is reached.
 */
export async function runBrowserServer(options: BrowserServerOptions): Promise<void> {
  const startedAtMs = Date.now();
  const userDataDirectory = await mkdtemp(join(tmpdir(), "demo-recorder-browser-"));
  process.on("exit", () => {
    try {
      rmSync(userDataDirectory, { recursive: true, force: true });
    } catch {
      // Best effort on the way out.
    }
  });
  let context: BrowserContext | undefined;
  let closing = false;
  let sawTouchFile = false;

  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    clearInterval(timer);
    await context?.close().catch(() => undefined);
    await rm(userDataDirectory, { recursive: true, force: true }).catch(() => undefined);
  };

  const timer = setInterval(() => {
    void (async () => {
      const touch = await touchState(options.touchFile);
      if (touch.exists) sawTouchFile = true;
      const ended = sawTouchFile && !touch.exists;
      const idleMs = Date.now() - touch.mtimeMs;
      if (
        ended ||
        idleMs > options.idleTimeoutMs ||
        Date.now() - startedAtMs > options.maxDurationMs
      ) {
        await shutdown();
        process.exit(0);
      }
    })();
  }, POLL_INTERVAL_MS);

  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

  try {
    context = await chromium.launchPersistentContext(userDataDirectory, {
      headless: options.headless,
      viewport: options.viewport,
      args: ["--remote-debugging-port=0"],
      ...(options.storageStatePath ? { storageState: options.storageStatePath } : {}),
    });
    const [port] = (await readFile(join(userDataDirectory, "DevToolsActivePort"), "utf8")).split(
      "\n",
    );
    if (!port) throw new Error("Chromium did not publish a DevTools port");
    await context.addInitScript({ content: HIDE_CURSOR_SCRIPT });
    await writeJsonAtomic(options.readyFile, {
      endpoint: `http://127.0.0.1:${port}`,
      pid: process.pid,
    });
  } catch (error) {
    await writeJsonAtomic(options.readyFile, {
      error: error instanceof Error ? error.message : String(error),
    });
    await shutdown();
    process.exit(1);
  }

  context.on("close", () => {
    void shutdown().finally(() => process.exit(0));
  });

  // Keep the process alive until the browser closes or a limit ends the session.
  await new Promise<void>(() => {});
}
