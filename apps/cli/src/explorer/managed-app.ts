import { spawn } from "node:child_process";

export type ManagedApp = {
  url: string;
  close(): Promise<void>;
};

export async function startManagedApp(options: {
  command: string;
  cwd: string;
  readinessUrl: string;
  timeoutMs?: number;
  log?: (line: string) => void;
}): Promise<ManagedApp> {
  const log = options.log ?? (() => undefined);
  const child = spawn(options.command, {
    cwd: options.cwd,
    shell: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => log(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => log(chunk.toString()));
  let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  child.once("exit", (code, signal) => {
    exited = { code, signal };
  });

  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  while (Date.now() < deadline) {
    if (exited)
      throw new Error(
        `Managed application exited before readiness (code ${exited.code ?? "none"}, signal ${exited.signal ?? "none"})`,
      );
    try {
      const response = await fetch(options.readinessUrl);
      if (response.ok) {
        let closed = false;
        return {
          url: options.readinessUrl,
          async close() {
            if (closed || child.exitCode !== null) return;
            closed = true;
            if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM");
            else child.kill("SIGTERM");
            await new Promise<void>((resolve) => {
              const timer = setTimeout(() => {
                child.kill("SIGKILL");
                resolve();
              }, 5_000);
              child.once("exit", () => {
                clearTimeout(timer);
                resolve();
              });
            });
          },
        };
      }
    } catch {
      // Continue polling until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM");
  else child.kill("SIGTERM");
  throw new Error(
    `Managed application was not ready after ${options.timeoutMs ?? 60_000}ms: ${options.readinessUrl}`,
  );
}
