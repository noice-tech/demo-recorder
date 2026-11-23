import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  act as runAct,
  cli,
  CliError,
  refOf,
  refsOf,
  serveFixture,
  type Observation,
} from "./support/cli.js";

type ActResult = {
  recordable: boolean;
  target: unknown;
  observation: Observation;
  blocked?: string[];
};

let fixture: Awaited<ReturnType<typeof serveFixture>>;
const projects: string[] = [];

const act = (project: string, action: object) => runAct<ActResult>(project, action);

async function startSession(
  url = fixture.baseUrl,
): Promise<{ project: string; observation: Observation }> {
  const project = await mkdtemp(join(tmpdir(), "demo-recorder-explore-"));
  projects.push(project);
  const started = await cli<{ observation: Observation }>(
    "explore",
    "start",
    "--project",
    project,
    "--url",
    url,
    "--json",
  );
  return { project, observation: started.observation };
}

beforeAll(async () => {
  fixture = await serveFixture();
});

afterAll(async () => {
  await Promise.all(
    projects.map((project) =>
      cli("explore", "finish", "--project", project, "--json").catch(() => undefined),
    ),
  );
  await Promise.all(projects.map((project) => rm(project, { recursive: true, force: true })));
  await fixture.close();
});

describe("explore", () => {
  it("acts on snapshot refs across commands and returns durable plan targets", async () => {
    const { project, observation: first } = await startSession();
    // The outline reaches into shadow DOM and iframes.
    expect(first.outline).toContain('button "Open shadow preview"');
    expect(first.outline).toContain('button "Preview action"');
    // It leaves page text to the full snapshot file.
    const copy = "Plan, review, and ship your next product update";
    expect(first.outline).not.toContain(copy);
    expect(await readFile(join(project, first.snapshotFile), "utf8")).toContain(copy);

    const tab = await act(project, {
      type: "click",
      observationId: first.id,
      ref: refOf(first.outline, 'tab "Activity"'),
    });
    expect(tab).toMatchObject({ recordable: true, target: { role: "tab", name: "Activity" } });
    // A ref the previous action introduced still resolves in the next command.
    const heading = await act(project, {
      type: "click",
      observationId: tab.observation.id,
      ref: refOf(tab.observation.outline, 'heading "Recent activity"'),
    });
    expect(heading).toMatchObject({
      recordable: true,
      target: { role: "heading", name: "Recent activity" },
    });

    // The same control in two named sections is narrowed to its section.
    const [, proPlan] = refsOf(heading.observation.outline, 'button "Choose plan"');
    const plan = await act(project, {
      type: "click",
      observationId: heading.observation.id,
      ref: proPlan,
    });
    expect(plan).toMatchObject({
      recordable: true,
      target: { role: "button", name: "Choose plan", within: { role: "region", name: "Pro plan" } },
    });

    // Identical controls with no named container cannot be told apart in a plan.
    const [, duplicate] = refsOf(plan.observation.outline, 'button "Open details"');
    const details = await act(project, {
      type: "click",
      observationId: plan.observation.id,
      ref: duplicate,
    });
    expect(details).toMatchObject({
      recordable: false,
      target: { role: "button", name: "Open details" },
    });

    const preview = await act(project, {
      type: "click",
      observationId: details.observation.id,
      ref: refOf(details.observation.outline, 'button "Preview action"'),
    });
    expect(preview).toMatchObject({
      recordable: true,
      target: { role: "button", name: "Preview action" },
    });

    const scrolled = await act(project, { type: "scroll", deltaY: 300 });
    expect(scrolled.observation.scroll.y).toBe(300);

    await expect(
      act(project, {
        type: "click",
        observationId: first.id,
        ref: refOf(first.outline, 'button "Create project"'),
      }),
    ).rejects.toThrow(/must match the current observation/);
    await expect(act(project, { type: "navigate", url: "https://example.com/" })).rejects.toThrow(
      /Navigation outside the allowed origins is blocked/,
    );
  }, 60_000);

  it("refuses a ref after the page changed without an observation", async () => {
    const { project, observation } = await startSession();
    const session = JSON.parse(await readFile(join(project, "session.json"), "utf8")) as {
      browser: { target: string };
    };
    const browser = await chromium.connectOverCDP(session.browser.target);
    try {
      const page = browser.contexts()[0]?.pages()[0];
      await page?.getByRole("button", { name: "Create project" }).evaluate((button) => {
        button.remove();
      });
    } finally {
      await browser.close();
    }

    await expect(
      act(project, {
        type: "click",
        observationId: observation.id,
        ref: refOf(observation.outline, 'button "Create project"'),
      }),
    ).rejects.toThrow(/page changed since obs-0001; e\d+ is no longer button "Create project"/);
  }, 30_000);

  it("blocks what recording would block, and says so", async () => {
    const page = `${fixture.baseUrl}obstacles.html`;
    const partner = new URL("/partner.html", page.replace("127.0.0.1", "localhost"));
    const { project, observation } = await startSession(page);

    const popup = await act(project, {
      type: "click",
      observationId: observation.id,
      ref: refOf(observation.outline, 'button "Open partner window"'),
    });
    expect(popup.blocked).toEqual([`new window ${partner.href}`]);

    const visit = await act(project, {
      type: "click",
      observationId: popup.observation.id,
      ref: refOf(popup.observation.outline, 'button "Visit partner"'),
    });
    expect(visit.blocked).toEqual([
      `off-origin navigation ${partner.href}; add ${partner.origin} to allowedOrigins to allow it`,
    ]);
  }, 60_000);

  it("names icon-font controls by their text", async () => {
    const { project, observation } = await startSession(`${fixture.baseUrl}obstacles.html`);
    const clicked = await act(project, {
      type: "click",
      observationId: observation.id,
      ref: refOf(observation.outline, 'button "PS5"'),
    });
    expect(clicked).toMatchObject({ target: { role: "button", name: "PS5" }, recordable: true });
  }, 60_000);

  it("fails fast with the reason when something covers the control", async () => {
    const { project, observation } = await startSession(`${fixture.baseUrl}obstacles.html`);
    const startedAt = Date.now();
    const failure = await act(project, {
      type: "click",
      observationId: observation.id,
      ref: refOf(observation.outline, 'button "Start trial"'),
    }).catch((error: unknown) => error);

    // Playwright's default would retry for 30 s.
    expect(Date.now() - startedAt).toBeLessThan(20_000);
    expect(failure).toBeInstanceOf(CliError);
    const report = JSON.parse((failure as CliError).stdout) as { ok: boolean; error: string };
    expect(report.ok).toBe(false);
    expect(report.error).toMatch(
      /^Could not click button "Start trial" .*: covered by <div id="consent-banner">$/,
    );
  }, 60_000);
});
