import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { act, cli, refOf, serveFixture, type Observation } from "./support/cli.js";

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
      ref: refOf(started.observation.snapshot, 'tab "Activity"'),
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
});
