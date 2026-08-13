import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultConfig,
  generateZoomSegments,
  loadRecordingManifest,
} from "@noice-tech/demo-recorder-core";
import { probeVideo } from "@noice-tech/demo-recorder-ffmpeg";
import { chromium } from "playwright";
import { afterAll, describe, expect, it } from "vitest";
import { resolveVisibleClickTarget } from "../src/browser/locator.js";
import { recordDemoPlan, resolvePlanLocator } from "../src/capture/index.js";
import { parseDemoPlan } from "../src/demo-plan/index.js";
import { rehearsalHoldDuration, rehearseDemoPlan } from "../src/rehearsal.js";
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
        { type: "press", key: "ControlOrMeta+K" },
        {
          type: "assert-visible",
          locator: { primary: { by: "role", role: "dialog", name: "Project details" } },
        },
        { type: "press", key: "Escape" },
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
  it("compresses editorial holds only in fast rehearsals", () => {
    expect(rehearsalHoldDuration(2_000, true)).toBe(100);
    expect(rehearsalHoldDuration(50, true)).toBe(50);
    expect(rehearsalHoldDuration(2_000, false)).toBe(2_000);
  });

  it("rejects ambiguous capture locators and accepts a unique fallback", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(
        '<button id="primary">Open details</button><button>Open details</button>' +
          '<input id="choice" type="radio"><label for="choice">Visible choice</label>',
      );
      await expect(
        resolvePlanLocator(page, {
          primary: { by: "role", role: "button", name: "Open details", exact: true },
        }),
      ).rejects.toThrow("No unique plan locator matched");
      const resolved = await resolvePlanLocator(page, {
        primary: { by: "role", role: "button", name: "Open details", exact: true },
        fallbacks: [{ by: "css", selector: "#primary" }],
      });
      expect(await resolved.getAttribute("id")).toBe("primary");

      const input = page.locator("#choice");
      const clickTarget = await resolveVisibleClickTarget(page, input);
      expect(await clickTarget.evaluate((element) => element.tagName)).toBe("LABEL");
    } finally {
      await browser.close();
    }
  }, 20_000);

  it("rehearses a plan without creating a video capture", async () => {
    const outputDirectory = await temporaryDirectory("demo-recorder-rehearsal-");
    const fixture = await startFixtureServer(fixtureDirectory);
    try {
      const report = await rehearseDemoPlan({
        plan: examplePlan(fixture.baseUrl),
        planPath: "demo-plan.json",
        outputDirectory,
        attempt: 1,
        headless: true,
      });
      expect(report.status).toBe("passed");
      expect(report.mode).toBe("full");
      expect(report.steps.every((step) => step.status === "passed")).toBe(true);
      await expect(access(join(outputDirectory, report.artifacts.report))).resolves.toBeUndefined();
      await expect(
        access(join(outputDirectory, report.artifacts.trace ?? "missing")),
      ).resolves.toBeUndefined();
      await expect(
        access(join(outputDirectory, report.artifacts.finalScreenshot ?? "missing")),
      ).resolves.toBeUndefined();
    } finally {
      await fixture.close();
    }
  }, 30_000);

  it("writes bounded repair evidence for a failed rehearsal", async () => {
    const outputDirectory = await temporaryDirectory("demo-recorder-rehearsal-failure-");
    const fixture = await startFixtureServer(fixtureDirectory);
    try {
      const plan = parseDemoPlan({
        version: 1,
        name: "failed-rehearsal",
        brief: { goal: "Exercise targeted rehearsal diagnostics" },
        target: { baseUrl: fixture.baseUrl },
        capture: {
          steps: [
            { type: "navigate", url: "/" },
            {
              type: "assert-visible",
              locator: { primary: { by: "text", text: "Missing state", exact: true } },
            },
          ],
        },
      });
      const report = await rehearseDemoPlan({
        plan,
        planPath: "failed.demo-plan.json",
        outputDirectory,
        attempt: 2,
        headless: true,
      });
      expect(report.status).toBe("failed");
      expect(report.failure).toMatchObject({ stepIndex: 2 });
      expect(report.failure?.repairHints.length).toBeGreaterThan(0);
      await expect(
        access(join(outputDirectory, report.artifacts.failureSnapshot ?? "missing")),
      ).resolves.toBeUndefined();
    } finally {
      await fixture.close();
    }
  }, 30_000);

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

      const sourcePath = join(outputDirectory, manifest.video.path);
      await expect(access(sourcePath)).resolves.toBeUndefined();
      const source = await probeVideo(sourcePath);
      expect(source.fps).toBe(60);
      expect(source.width).toBe(1440);
      expect(source.height).toBe(900);
      const diagnostics = JSON.parse(
        await readFile(join(outputDirectory, "metadata.json"), "utf8"),
      ) as { recorder?: string; fps?: number; emittedFrames?: number };
      expect(diagnostics).toMatchObject({ recorder: "cdp-ffmpeg", fps: 60 });
      expect(diagnostics.emittedFrames).toBeGreaterThan(0);
      await expect(access(join(outputDirectory, "demo-plan.json"))).resolves.toBeUndefined();
      await expect(access(join(outputDirectory, "presentation.json"))).resolves.toBeUndefined();
      expect(manifest.version).toBe(2);
      expect(manifest.events.some((event) => event.type === "click")).toBe(true);
      expect(
        manifest.events.filter((event) => event.type === "key-press").map((event) => event.keys),
      ).toEqual([[process.platform === "darwin" ? "Meta" : "Control", "K"], ["Escape"]]);
      const initialCursor = manifest.events.find((event) => event.type === "cursor-move");
      expect(initialCursor).toMatchObject({ x: 32, y: 32 });
      expect(initialCursor?.timestampMs).toBeLessThan(10);
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
