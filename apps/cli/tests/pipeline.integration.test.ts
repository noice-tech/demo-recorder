import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultConfig,
  generateZoomSegments,
  loadRecordingManifest,
} from "@noice-tech/demo-recorder-core";
import { afterAll, describe, expect, it } from "vitest";
import { recordDemoPlan } from "../src/capture/index.js";
import { parseDemoPlan } from "../src/demo-plan/index.js";
import { startFixtureServer } from "./support/fixture-server.js";

const fixtureDirectory = fileURLToPath(new URL("fixtures/example-app", import.meta.url));
const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function examplePlan(baseUrl: string) {
  return parseDemoPlan({
    version: 1,
    name: "integration-plan",
    brief: {
      goal: "Show a project progressing from creation to launch",
      constraints: { submitForms: false, modifyData: true, sameOriginOnly: true },
    },
    target: { baseUrl },
    capture: {
      steps: [
        { type: "navigate", url: "/" },
        {
          type: "click",
          locator: { primary: { by: "role", role: "button", name: "Create project" } },
        },
        {
          type: "click",
          locator: { primary: { by: "role", role: "button", name: "Approve brief" } },
        },
        {
          type: "click",
          locator: { primary: { by: "role", role: "button", name: "Launch project" } },
        },
        {
          type: "assert-visible",
          locator: { primary: { by: "text", text: "Project launched", exact: true } },
        },
        { type: "hold", durationMs: 300 },
      ],
    },
  });
}

afterAll(async () => {
  await Promise.all(temporaryDirectories.map((path) => rm(path, { recursive: true, force: true })));
});

describe.sequential("capture pipeline", () => {
  it("starts a ready test fixture and shuts it down", async () => {
    const fixture = await startFixtureServer(fixtureDirectory);
    expect((await fetch(`${fixture.baseUrl}/__ready`)).status).toBe(200);
    await fixture.close();
    await expect(fetch(`${fixture.baseUrl}/__ready`)).rejects.toThrow();
  });

  it("executes a plan and records valid capture artifacts", async () => {
    const parent = await temporaryDirectory("demo-recorder-plan-recording-");
    const fixture = await startFixtureServer(fixtureDirectory);
    const outputDirectory = join(parent, "plan-recording");
    try {
      const manifest = await recordDemoPlan(examplePlan(fixture.baseUrl), {
        outputDirectory,
        viewport: { width: 1440, height: 900 },
        headless: true,
      });

      await expect(access(join(outputDirectory, manifest.video.path))).resolves.toBeUndefined();
      await expect(access(join(outputDirectory, "demo-plan.json"))).resolves.toBeUndefined();
      await expect(access(join(outputDirectory, "presentation.json"))).resolves.toBeUndefined();
      expect(manifest.events.some((event) => event.type === "click")).toBe(true);
      expect(manifest.events.some((event) => event.type === "cursor-move")).toBe(true);
      expect(
        generateZoomSegments(manifest.events, manifest.durationMs, defaultConfig.zoom).length,
      ).toBeGreaterThan(0);

      const persistedManifest = await loadRecordingManifest(
        join(outputDirectory, "recording.json"),
      );
      expect(persistedManifest.durationMs).toBe(manifest.durationMs);
    } finally {
      await fixture.close();
    }
  }, 30_000);

  it("removes incomplete output after a thrown browser session", async () => {
    const parent = await temporaryDirectory("demo-recorder-integration-failure-");
    const outputDirectory = join(parent, "failed-recording");
    const fixture = await startFixtureServer(fixtureDirectory);
    try {
      const failingPlan = parseDemoPlan({
        version: 1,
        name: "failing-plan",
        brief: { goal: "Verify failed plan cleanup" },
        target: { baseUrl: fixture.baseUrl },
        capture: {
          steps: [
            { type: "navigate", url: "/" },
            {
              type: "assert-visible",
              locator: { primary: { by: "text", text: "This target does not exist" } },
            },
          ],
        },
      });
      await expect(
        recordDemoPlan(failingPlan, {
          outputDirectory,
          viewport: { width: 1440, height: 900 },
          headless: true,
        }),
      ).rejects.toThrow("Plan recording failed");
    } finally {
      await fixture.close();
    }
    expect(await readdir(parent)).not.toContain("failed-recording");
  }, 30_000);
});
