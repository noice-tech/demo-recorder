import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cli, serveFixture } from "./support/cli.js";

let fixture: Awaited<ReturnType<typeof serveFixture>>;
const projects: string[] = [];

async function projectWith(steps: object[]): Promise<string> {
  const project = await mkdtemp(join(tmpdir(), "demo-recorder-rehearse-"));
  projects.push(project);
  const url = `${fixture.baseUrl}obstacles.html`;
  await writeFile(
    join(project, "plan.json"),
    JSON.stringify({
      version: 1,
      name: "checkout",
      goal: "Open the store from checkout",
      target: { baseUrl: url },
      viewport: { width: 1280, height: 720 },
      steps: [{ type: "navigate", url }, ...steps],
    }),
  );
  return project;
}

async function zoomOn(project: string, step: number): Promise<void> {
  await writeFile(
    join(project, "presentation.json"),
    JSON.stringify({ version: 1, zooms: [{ step, scale: 1.4 }] }),
  );
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

beforeAll(async () => {
  fixture = await serveFixture();
});

afterAll(async () => {
  await Promise.all(projects.map((project) => rm(project, { recursive: true, force: true })));
  await fixture.close();
});

describe("plan rehearse and record", () => {
  it("reject a zoom on a hold before any browser starts", async () => {
    const project = await projectWith([
      { type: "hold", durationMs: 100 },
      { type: "scroll", deltaY: 120 },
    ]);
    const holdProblem = "zooms[0] anchors step 2, a hold, which records no events";

    await zoomOn(project, 2);
    await expect(cli("plan", "rehearse", "--project", project)).rejects.toThrow(holdProblem);
    expect(await exists(join(project, "rehearsal-report.json"))).toBe(false);

    await zoomOn(project, 3);
    await cli("plan", "rehearse", "--project", project);

    // Styling edits keep the rehearsal valid, so record checks the anchors again.
    await zoomOn(project, 2);
    await expect(cli("record", "--project", project)).rejects.toThrow(holdProblem);
    expect(await exists(join(project, "recording"))).toBe(false);
  }, 60_000);

  it("explains a navigation the site never finishes", async () => {
    const project = await projectWith([
      {
        type: "click",
        target: { role: "link", name: "Open store" },
        expect: { url: "/store", timeoutMs: 1_500 },
      },
    ]);

    const failure = await cli("plan", "rehearse", "--project", project).catch(
      (error: unknown) => error as Error,
    );

    expect(failure.message).toContain("Step 2 (click) failed");
    expect(failure.message).toContain(`${fixture.baseUrl}stall/store requested`);
    expect(failure.message).toContain("never finished");
    expect(failure.message).toContain("No evidence");
  }, 60_000);

  it("record logs a page change at the click that caused it", async () => {
    const project = await projectWith([
      { type: "hold", durationMs: 300 },
      // No expect: the address bar must follow the click anyway.
      { type: "click", target: { role: "link", name: "Back to workspace" } },
      { type: "hold", durationMs: 600 },
    ]);
    await cli("plan", "rehearse", "--project", project);
    const recorded = await cli<{ events: string }>("record", "--project", project);

    const { events } = JSON.parse(await readFile(recorded.events, "utf8")) as {
      events: { type: string; step?: number; url?: string }[];
    };
    expect(events.filter((event) => event.type === "navigation").at(-1)).toMatchObject({
      step: 3,
      url: fixture.baseUrl,
    });
  }, 90_000);
});
