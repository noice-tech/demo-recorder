import { execFile } from "node:child_process";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execute = promisify(execFile);
const cliEntry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const fixture = fileURLToPath(new URL("fixtures/example-app/", import.meta.url));
const contentTypes: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
};

type Observation = { id: string; snapshot: string; scroll: { x: number; y: number } };
type ActResult = {
  recordable: boolean;
  target: unknown;
  observation: Observation;
};

let server: Server;
let baseUrl: string;
const projects: string[] = [];

/** Runs one CLI command in its own process, as an agent does. */
async function cli<Result>(...args: string[]): Promise<Result> {
  try {
    const { stdout } = await execute(process.execPath, ["--import", "tsx", cliEntry, ...args], {
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(stdout) as Result;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? "";
    throw new Error(stderr.trim() || String(error), { cause: error });
  }
}

async function startSession(): Promise<{ project: string; observation: Observation }> {
  const project = await mkdtemp(join(tmpdir(), "demo-recorder-explore-"));
  projects.push(project);
  const started = await cli<{ observation: Observation }>(
    "explore",
    "start",
    "--project",
    project,
    "--url",
    baseUrl,
    "--json",
  );
  return { project, observation: started.observation };
}

async function act(project: string, action: object): Promise<ActResult> {
  const input = join(project, "action.json");
  await writeFile(input, JSON.stringify(action));
  return cli<ActResult>("explore", "act", "--project", project, "--input", input, "--json");
}

/** Refs the snapshot shows for an element, in page order. */
function refsOf(snapshot: string, element: string): string[] {
  return snapshot
    .split("\n")
    .filter((line) => line.includes(`- ${element} `) || line.endsWith(`- ${element}`))
    .map((line) => /\[ref=([^\]]+)\]/.exec(line)?.[1])
    .filter((ref): ref is string => ref !== undefined);
}

function refOf(snapshot: string, element: string): string {
  const [ref] = refsOf(snapshot, element);
  if (!ref) throw new Error(`No ref for ${element} in:\n${snapshot}`);
  return ref;
}

beforeAll(async () => {
  server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    const file = join(fixture, path === "/" ? "index.html" : path);
    readFile(file).then(
      (body) => {
        response.writeHead(200, { "content-type": contentTypes[extname(file)] ?? "text/plain" });
        response.end(body);
      },
      () => {
        response.writeHead(404);
        response.end();
      },
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No server address");
  baseUrl = `http://127.0.0.1:${address.port}/`;
});

afterAll(async () => {
  await Promise.all(
    projects.map((project) =>
      cli("explore", "finish", "--project", project, "--json").catch(() => undefined),
    ),
  );
  await Promise.all(projects.map((project) => rm(project, { recursive: true, force: true })));
  await new Promise((done) => server.close(done));
});

describe("explore", () => {
  it("acts on snapshot refs across commands and returns durable plan targets", async () => {
    const { project, observation: first } = await startSession();
    // The snapshot reaches into shadow DOM and iframes.
    expect(first.snapshot).toContain('button "Open shadow preview"');
    expect(first.snapshot).toContain('button "Preview action"');

    const tab = await act(project, {
      type: "click",
      observationId: first.id,
      ref: refOf(first.snapshot, 'tab "Activity"'),
    });
    expect(tab).toMatchObject({ recordable: true, target: { role: "tab", name: "Activity" } });
    // A ref the previous action introduced still resolves in the next command.
    const heading = await act(project, {
      type: "click",
      observationId: tab.observation.id,
      ref: refOf(tab.observation.snapshot, 'heading "Recent activity"'),
    });
    expect(heading).toMatchObject({
      recordable: true,
      target: { role: "heading", name: "Recent activity" },
    });

    // The same control in two named sections is narrowed to its section.
    const [, proPlan] = refsOf(heading.observation.snapshot, 'button "Choose plan"');
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
    const [, duplicate] = refsOf(plan.observation.snapshot, 'button "Open details"');
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
      ref: refOf(details.observation.snapshot, 'button "Preview action"'),
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
        ref: refOf(first.snapshot, 'button "Create project"'),
      }),
    ).rejects.toThrow(/must match the current observation/);
    await expect(act(project, { type: "navigate", url: "https://example.com/" })).rejects.toThrow(
      /Off-origin navigation is blocked/,
    );
  });

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
        ref: refOf(observation.snapshot, 'button "Create project"'),
      }),
    ).rejects.toThrow(/page changed since obs-0001; e\d+ is no longer button "Create project"/);
  });
});
