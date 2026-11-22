import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { act, cli, refOf, serveFixture, startCli, type Observation } from "./support/cli.js";

let fixture: Awaited<ReturnType<typeof serveFixture>>;
let project: string;

type Metrics = Record<string, number>;

function planWith(buttonName: string) {
  return {
    version: 1,
    name: "launch",
    goal: "Create a project",
    target: { baseUrl: fixture.baseUrl },
    viewport: { width: 1280, height: 720 },
    steps: [
      { type: "navigate", url: fixture.baseUrl },
      { type: "hold", durationMs: 300 },
      {
        type: "click",
        target: { role: "button", name: buttonName },
        expect: { visible: { role: "heading", name: "Summer campaign" } },
      },
      { type: "hold", durationMs: 300 },
    ],
  };
}

beforeAll(async () => {
  fixture = await serveFixture();
  project = await mkdtemp(join(tmpdir(), "demo-recorder-run-"));
});

afterAll(async () => {
  await cli("explore", "finish", "--project", project).catch(() => undefined);
  await rm(project, { recursive: true, force: true });
  await fixture.close();
});

describe("a demo run", () => {
  it("records where the time went, from exploration to the rendered video", async () => {
    const started = await cli<{ observation: Observation }>(
      "explore",
      "start",
      "--project",
      project,
      "--url",
      fixture.baseUrl,
    );
    await act(project, {
      type: "click",
      observationId: started.observation.id,
      ref: refOf(started.observation.outline, 'tab "Activity"'),
    });
    await cli("explore", "finish", "--project", project);

    // The first plan misnames the button; one repair makes it pass.
    const planPath = join(project, "plan.json");
    await writeFile(planPath, JSON.stringify(planWith("Create")));
    await expect(cli("plan", "rehearse", "--project", project)).rejects.toThrow(
      /No element matches button "Create"/,
    );
    await writeFile(planPath, JSON.stringify(planWith("Create project")));
    await cli("plan", "rehearse", "--project", project);

    const recorded = await cli<{ run: string; metrics: Metrics }>("record", "--project", project);

    const run = JSON.parse(await readFile(recorded.run, "utf8")) as {
      runId: string;
      metrics: Metrics;
    };
    expect(run.metrics).toEqual(recorded.metrics);
    expect(run.metrics).toMatchObject({ exploreActions: 1, rehearsals: 2, repairAttempts: 1 });
    const phases = ["explorationMs", "planningMs", "rehearsalMs", "captureMs", "renderMs"];
    for (const phase of phases) expect(run.metrics[phase]).toBeGreaterThanOrEqual(0);
    expect(run.metrics.captureMs).toBeGreaterThan(600);
    const phaseTotal = phases.reduce((sum, phase) => sum + (run.metrics[phase] ?? 0), 0);
    expect(phaseTotal).toBeLessThanOrEqual(run.metrics.totalMs ?? 0);
    expect(run.metrics.toolMs).toBeLessThanOrEqual(run.metrics.totalMs ?? 0);

    // Every run command is logged under the run that explore start began.
    const log = (await readFile(join(project, "run-log.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { runId: string; command: string; ok: boolean });
    expect(log.map(({ command, ok }) => [command, ok])).toEqual([
      ["explore start", true],
      ["explore act", true],
      ["explore finish", true],
      ["plan rehearse", false],
      ["plan rehearse", true],
      ["record", true],
    ]);
    expect(new Set(log.map((entry) => entry.runId))).toEqual(new Set([run.runId]));
  }, 120_000);

  it("logs a command stopped by a signal as interrupted, not failed", async () => {
    const stopped = await mkdtemp(join(tmpdir(), "demo-recorder-interrupt-"));
    try {
      const plan = planWith("Create project");
      // Waits long enough on a status that never shows to be stopped midway.
      plan.steps[1] = {
        type: "hold",
        durationMs: 100,
        expect: { visible: { name: "Never shown" }, timeoutMs: 30_000 },
      } as never;
      await writeFile(join(stopped, "plan.json"), JSON.stringify(plan));
      const child = startCli("record", "--skip-rehearsal", "--project", stopped);
      const exited = new Promise((done) => child.on("exit", done));
      // Capture has started once the recording folder exists.
      for (let tries = 0; tries < 300; tries += 1) {
        if (
          await access(join(stopped, "recording")).then(
            () => true,
            () => false,
          )
        )
          break;
        await new Promise((done) => setTimeout(done, 100));
      }
      child.kill("SIGINT");

      expect(await exited).toBe(130);
      const log = (await readFile(join(stopped, "run-log.jsonl"), "utf8")).trim();
      expect(JSON.parse(log)).toMatchObject({ command: "record", ok: false, interrupted: true });
    } finally {
      await rm(stopped, { recursive: true, force: true });
    }
  }, 60_000);
});
