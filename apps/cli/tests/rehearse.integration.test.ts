import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cli, serveFixture } from "./support/cli.js";

let fixture: Awaited<ReturnType<typeof serveFixture>>;
const projects: string[] = [];

async function projectWith(steps: object[], page = "obstacles.html"): Promise<string> {
  const project = await mkdtemp(join(tmpdir(), "demo-recorder-rehearse-"));
  projects.push(project);
  const url = `${fixture.baseUrl}${page}`;
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

type PlanFile = { target: object; steps: { durationMs?: number }[] };

async function editPlan(project: string, edit: (plan: PlanFile) => void): Promise<void> {
  const path = join(project, "plan.json");
  const plan = JSON.parse(await readFile(path, "utf8")) as PlanFile;
  edit(plan);
  await writeFile(path, JSON.stringify(plan));
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

  it("allow only the plan's origins, while embedded frames load from anywhere", async () => {
    const project = await projectWith([
      // The preview frame comes from the other origin.
      {
        type: "hold",
        durationMs: 100,
        expect: { visible: { role: "heading", name: "Partner store" } },
      },
      {
        type: "click",
        target: { role: "button", name: "Visit partner" },
        expect: { url: "/partner.html", timeoutMs: 1_500 },
      },
    ]);
    const partner = fixture.baseUrl.replace("127.0.0.1", "localhost").replace(/\/$/, "");

    await expect(cli("plan", "rehearse", "--project", project)).rejects.toThrow(
      `Step 3 (click) failed: Expectation did not hold`,
    );
    const report = JSON.parse(await readFile(join(project, "rehearsal-report.json"), "utf8")) as {
      error: string;
    };
    expect(report.error).toContain(`add ${partner} to allowedOrigins`);

    await editPlan(project, (plan) => {
      plan.target = { ...plan.target, allowedOrigins: [partner] };
    });
    await cli("plan", "rehearse", "--project", project);
  }, 60_000);

  it("act on controls that appear late, sit under their label, or have hidden copies", async () => {
    const status = (text: string) => ({ visible: { name: text }, timeoutMs: 1_000 });
    const project = await projectWith([
      {
        type: "click",
        target: { role: "button", name: "Accept cookies" },
        expect: status("Cookies accepted"),
      },
      {
        type: "click",
        target: { role: "radio", name: "Night Sky" },
        expect: status("Selected Night Sky"),
      },
      {
        type: "click",
        target: { selector: "button.more" },
        expect: status("Showing more finishes"),
      },
    ]);
    await cli("plan", "rehearse", "--project", project);
  }, 60_000);

  it("scroll to a heading that renders late, on a page that ignores the wheel at first", async () => {
    const reviews = await projectWith(
      [{ type: "scroll", to: { role: "heading", name: "Owners' reviews" } }],
      "long.html",
    );
    await cli("plan", "rehearse", "--project", reviews);

    const specs = await projectWith(
      [{ type: "scroll", to: { role: "heading", name: "Specs" } }],
      "long.html",
    );
    await expect(cli("plan", "rehearse", "--project", specs)).rejects.toThrow(
      'heading "Specs" did not appear while scrolling to the end of the page',
    );
  }, 60_000);

  it("record leaves a report and evidence when a step fails", async () => {
    const project = await projectWith([
      { type: "hold", durationMs: 100, expect: { url: "/nowhere", timeoutMs: 500 } },
    ]);
    await expect(cli("record", "--skip-rehearsal", "--project", project)).rejects.toThrow(
      "Evidence: record-report.json, evidence/step-2.png, evidence/step-2.yml",
    );
    const report = JSON.parse(await readFile(join(project, "record-report.json"), "utf8")) as {
      ok: boolean;
      error: string;
    };
    expect(report.ok).toBe(false);
    expect(report.error).toContain("Step 2 (hold) failed");
  }, 60_000);

  it("rehearse without sitting through holds, then record the page change at its click", async () => {
    const project = await projectWith([
      { type: "hold", durationMs: 4_000 },
      // No expect: the address bar must follow the click anyway.
      { type: "click", target: { role: "link", name: "Back to workspace" } },
      { type: "hold", durationMs: 600 },
    ]);
    const startedAt = Date.now();
    await cli("plan", "rehearse", "--project", project);
    expect(Date.now() - startedAt).toBeLessThan(4_000);

    // Hold lengths are pacing, so shortening one keeps the rehearsal's approval.
    await editPlan(project, (plan) => {
      plan.steps[1] = { ...plan.steps[1], durationMs: 300 };
    });
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
