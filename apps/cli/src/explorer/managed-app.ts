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

  const processGroupId = process.platform !== "win32" ? child.pid : undefined;
  const signalProcess = (signal: NodeJS.Signals): void => {
    if (processGroupId) {
      try {
        process.kill(-processGroupId, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    } else if (child.exitCode === null) child.kill(signal);
  };
  const processIsRunning = (): boolean => {
    if (processGroupId) {
      try {
        process.kill(-processGroupId, 0);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
        throw error;
      }
    }
    return child.exitCode === null;
  };
  const terminate = async (): Promise<void> => {
    if (!processIsRunning()) return;
    signalProcess("SIGTERM");
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (!processIsRunning()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    signalProcess("SIGKILL");
  };

  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  while (Date.now() < deadline) {
    try {
      const response = await fetch(options.readinessUrl);
      if (response.ok) {
        let closed = false;
        return {
          url: options.readinessUrl,
          async close() {
            if (closed) return;
            closed = true;
            await terminate();
          },
        };
      }
    } catch {
      // Continue polling until the deadline.
    }
    if (exited && !processIsRunning())
      throw new Error(
        `Managed application exited before readiness (code ${exited.code ?? "none"}, signal ${exited.signal ?? "none"})`,
      );
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await terminate();
  throw new Error(
    `Managed application was not ready after ${options.timeoutMs ?? 60_000}ms: ${options.readinessUrl}`,
  );
}
