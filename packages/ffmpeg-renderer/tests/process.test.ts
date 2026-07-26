import { describe, expect, it } from "vitest";
import { runProcess } from "../src/index.js";

describe("runProcess", () => {
  it("reports an executable that cannot be spawned", async () => {
    await expect(runProcess("definitely-not-a-real-demo-recorder-command", [])).rejects.toThrow();
  });

  it("waits for an aborted child process to close", async () => {
    const controller = new AbortController();
    const running = runProcess(process.execPath, ["-e", "setInterval(() => undefined, 1000)"], {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 30);
    await expect(running).rejects.toThrow();
  });
});
