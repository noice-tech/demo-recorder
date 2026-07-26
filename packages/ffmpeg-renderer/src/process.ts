import { spawn } from "node:child_process";

export type RunProcessOptions = {
  cwd?: string;
  signal?: AbortSignal;
  stdin?: "ignore" | "inherit";
  onStdout?: (chunk: Buffer) => void;
  onStderr?: (chunk: Buffer) => void;
  onProgress?: (chunk: Buffer) => void;
};

export type ProcessResult = {
  stdout: string;
  stderr: string;
};

export async function runProcess(
  executable: string,
  arguments_: readonly string[],
  options: RunProcessOptions = {},
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...arguments_], {
      cwd: options.cwd,
      signal: options.signal,
      windowsHide: true,
      stdio: [options.stdin ?? "ignore", "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
    };
    child.stdout!.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      options.onStdout?.(chunk);
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 100_000) stderr = stderr.slice(-100_000);
      options.onStderr?.(chunk);
    });
    child.stdio[3]?.on("data", (chunk: Buffer) => options.onProgress?.(chunk));
    child.once("error", (error) => finish(() => reject(error)));
    child.once("exit", (code, signal) => {
      finish(() => {
        if (code === 0) resolve({ stdout, stderr });
        else {
          const reason = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
          reject(new Error(`${executable} failed with ${reason}: ${stderr.slice(-4_000).trim()}`));
        }
      });
    });
  });
}
