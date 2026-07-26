import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  actInInteractiveSession,
  findInInteractiveSession,
  finishInteractiveSession,
  InteractiveExplorationSession,
  observeInteractiveSession,
  startInteractiveSession,
  startManagedApp,
  verifyInteractiveSession,
  type ExplorationLaunchConfig,
} from "../src/explorer/index.js";
import { startFixtureServer, type FixtureServer } from "./support/fixture-server.js";

const fixtureDirectory = fileURLToPath(new URL("fixtures/example-app", import.meta.url));
const temporaryDirectories: string[] = [];
const fixtures: FixtureServer[] = [];
const httpServers: ReturnType<typeof createServer>[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function fixture(): Promise<FixtureServer> {
  const value = await startFixtureServer(fixtureDirectory);
  fixtures.push(value);
  return value;
}

function launchConfig(
  id: string,
  baseUrl: string,
  outputDirectory: string,
  policy: "read-only" | "reversible",
): ExplorationLaunchConfig {
  return {
    version: 1,
    id,
    baseUrl,
    outputDirectory,
    headless: true,
    policy,
    maxActions: 10,
    maxDurationMs: 30_000,
  };
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((value) => value.close().catch(() => undefined)));
  await Promise.all(
    httpServers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe.sequential("interactive exploration", () => {
  it("captures ARIA evidence and blocks mutation-like controls in read-only mode", async () => {
    const app = await fixture();
    const outputDirectory = await temporaryDirectory("demo-recorder-interactive-readonly-");
    const session = new InteractiveExplorationSession(
      launchConfig(
        "read-only",
        `${app.baseUrl}/?token=private#fragment`,
        outputDirectory,
        "read-only",
      ),
    );
    try {
      const observation = await session.start();
      expect(observation.url).toBe(`${app.baseUrl}/`);
      const createProject = observation.interactiveElements.find(
        (element) => element.name === "Create project",
      );
      expect(createProject?.risk).toBe("reversible");
      await expect(
        access(join(outputDirectory, observation.artifacts.snapshot)),
      ).resolves.toBeUndefined();
      await expect(
        access(join(outputDirectory, observation.artifacts.screenshot)),
      ).resolves.toBeUndefined();

      const transition = await session.act({
        type: "click",
        observationId: observation.id,
        ref: createProject?.ref ?? "missing",
      });
      expect(transition.status).toBe("blocked");
      expect(transition.policy.allowed).toBe(false);
      const externalNavigation = await session.act({
        type: "goto",
        url: "https://example.com/outside",
      });
      expect(externalNavigation.status).toBe("blocked");
      expect(externalNavigation.policy.risk).toBe("external-side-effect");
      const failedVerification = await session.verify({
        version: 1,
        transitionIds: [transition.id],
      });
      expect(failedVerification.status).toBe("failed");
      expect(failedVerification.error).toMatch(/not a replayable successful transition/);
      expect(session.report().metrics).toMatchObject({
        observations: 1,
        verifications: 1,
        verifiedPaths: 0,
      });
    } finally {
      await session.close("finished");
    }
  }, 30_000);

  it("requires explicit approval before exporting query-based URL state", async () => {
    const app = await fixture();
    const outputDirectory = await temporaryDirectory("demo-recorder-interactive-url-state-");
    const session = new InteractiveExplorationSession(
      launchConfig("url-state", `${app.baseUrl}/?view=activity`, outputDirectory, "read-only"),
    );
    try {
      await session.start();
      const transition = await session.act({ type: "wait", durationMs: 10 });
      const verification = await session.verify({
        version: 1,
        transitionIds: [transition.id],
      });
      expect(verification.status).toBe("passed");
      expect(() =>
        session.exportPlan({
          version: 1,
          verificationId: verification.id,
          name: "query-state",
          goal: "Reproduce an explicitly approved query state",
        }),
      ).toThrow(/includeUrlState/);
      const plan = session.exportPlan({
        version: 1,
        verificationId: verification.id,
        name: "query-state",
        goal: "Reproduce an explicitly approved query state",
        includeUrlState: true,
      });
      expect(plan.capture.steps[0]).toMatchObject({
        type: "navigate",
        url: "/?view=activity",
      });
    } finally {
      await session.close("finished");
    }
  }, 30_000);

  it("observes tabs, dialogs, shadow controls, and conservative frame/risk boundaries", async () => {
    const app = await fixture();
    const outputDirectory = await temporaryDirectory("demo-recorder-interactive-states-");
    const session = new InteractiveExplorationSession(
      launchConfig("states", app.baseUrl, outputDirectory, "read-only"),
    );
    try {
      const observation = await session.start();
      expect(
        observation.interactiveElements.some((element) => element.name === "Open shadow preview"),
      ).toBe(true);
      expect(
        observation.interactiveElements.some((element) => element.name === "Preview action"),
      ).toBe(false);
      expect(
        observation.interactiveElements
          .find((element) => element.name === "Numeric ID control")
          ?.target.candidates.some(
            (candidate) => candidate.by === "css" && candidate.selector === '[id="123"]',
          ),
      ).toBe(true);
      expect(
        observation.interactiveElements.find((element) => element.name === "Delete workspace")
          ?.risk,
      ).toBe("destructive");
      expect(
        observation.interactiveElements.find((element) => element.name === "Open external example")
          ?.risk,
      ).toBe("external-side-effect");
      expect(
        observation.interactiveElements.find((element) => element.name === "Download preview")
          ?.risk,
      ).toBe("external-side-effect");
      expect(
        observation.interactiveElements.find((element) => element.name === "Save workspace")?.risk,
      ).toBe("unknown");
      const activity = observation.interactiveElements.find(
        (element) => element.role === "tab" && element.name === "Activity",
      );
      const tabTransition = await session.act({
        type: "click",
        observationId: observation.id,
        ref: activity?.ref ?? "missing",
      });
      expect(tabTransition.status).toBe("succeeded");
      expect(tabTransition.diff?.headingsAdded).toContain("Recent activity");
      const activityObservation = await session.observe("async-state");
      const insights = activityObservation.interactiveElements.find(
        (element) => element.name === "View insights",
      );
      const insightsTransition = await session.act({
        type: "click",
        observationId: activityObservation.id,
        ref: insights?.ref ?? "missing",
      });
      expect(insightsTransition.status).toBe("succeeded");
      expect(insightsTransition.outcome.settledReason).toBe("quiet");
      const insightsObservation = await session.observe("open-layer");
      expect(
        await readFile(join(outputDirectory, insightsObservation.artifacts.snapshot), "utf8"),
      ).toContain("Insights ready");
      const details = insightsObservation.interactiveElements.find((element) =>
        element.target.candidates.some(
          (candidate) => candidate.by === "css" && candidate.selector === "#open-details",
        ),
      );
      const dialogTransition = await session.act({
        type: "click",
        observationId: insightsObservation.id,
        ref: details?.ref ?? "missing",
      });
      expect(dialogTransition.status).toBe("succeeded");
      expect(dialogTransition.diff?.layersAdded).toContain("dialog|Project details");
      const verification = await session.verify({
        version: 1,
        transitionIds: [tabTransition.id, insightsTransition.id, dialogTransition.id],
      });
      expect(verification.status).toBe("passed");
      expect(verification.steps[2]?.candidateUsed).toEqual({
        by: "css",
        selector: "#open-details",
      });
    } finally {
      await session.close("finished");
    }
  }, 40_000);

  it("records a same-URL state transition when reversible exploration is explicit", async () => {
    const app = await fixture();
    const outputDirectory = await temporaryDirectory("demo-recorder-interactive-reversible-");
    const session = new InteractiveExplorationSession(
      launchConfig("reversible", app.baseUrl, outputDirectory, "reversible"),
    );
    try {
      const observation = await session.start();
      const createProject = observation.interactiveElements.find(
        (element) => element.name === "Create project",
      );
      const transition = await session.act({
        type: "click",
        observationId: observation.id,
        ref: createProject?.ref ?? "missing",
      });
      expect(transition.status).toBe("succeeded");
      expect(transition.outcome.urlChanged).toBe(false);
      expect(transition.outcome.semanticChanged).toBe(true);
      expect(transition.toStateId).not.toBe(transition.fromStateId);
      expect(transition.diff?.controlsAdded.length).toBeGreaterThan(0);
      const createdObservation = await session.observe("select-next-step");
      expect(createdObservation.stateId).toBe(transition.toStateId);
      const approveBrief = createdObservation.interactiveElements.find((element) =>
        element.name.includes("Approve brief"),
      );
      const approvalTransition = await session.act({
        type: "click",
        observationId: createdObservation.id,
        ref: approveBrief?.ref ?? "missing",
      });
      expect(approvalTransition.status).toBe("succeeded");
      expect(session.report().metrics.observations).toBe(4);

      const verification = await session.verify({
        version: 1,
        transitionIds: [transition.id, approvalTransition.id],
      });
      expect(verification.status).toBe("passed");
      expect(verification.steps).toHaveLength(2);
      expect(verification.steps[0]).toMatchObject({
        transitionId: transition.id,
        status: "passed",
        candidateUsed: { by: "role", role: "button", name: "Create project" },
      });
      expect(verification.steps[1]).toMatchObject({
        transitionId: approvalTransition.id,
        status: "passed",
        candidateUsed: { by: "role", role: "button" },
      });
      const draftPlan = session.exportPlan({
        version: 1,
        verificationId: verification.id,
        name: "verified-project-flow",
        goal: "Show the verified project setup flow",
      });
      expect(draftPlan.brief.constraints.modifyData).toBe(true);
      expect(
        draftPlan.capture.steps.some(
          (step) =>
            step.type === "assert-visible" &&
            step.locator.primary.by === "role" &&
            step.locator.primary.name === "Summer campaign",
        ),
      ).toBe(true);
      await expect(
        access(join(outputDirectory, verification.artifacts.report)),
      ).resolves.toBeUndefined();
      await expect(
        access(join(outputDirectory, verification.artifacts.trace ?? "missing")),
      ).resolves.toBeUndefined();

      const actionsBeforeStaleRequest = session.report().metrics.actions;
      await expect(
        session.act({
          type: "click",
          observationId: observation.id,
          ref: createProject?.ref ?? "missing",
        }),
      ).rejects.toThrow("Stale observation reference");
      expect(session.report().metrics.actions).toBe(actionsBeforeStaleRequest);
    } finally {
      await session.close("finished");
    }
  }, 30_000);

  it("replays a unique fallback when the primary locator is ambiguous", async () => {
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "text/html");
      response.end(`<!doctype html><html><body>
        <h1 id="state">Overview</h1>
        <button id="primary">Open details</button>
        <button id="duplicate">Open details</button>
        <script>document.querySelector('#primary').onclick = () => { document.querySelector('#state').textContent = 'Details'; };</script>
      </body></html>`);
    });
    httpServers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test address");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const outputDirectory = await temporaryDirectory("demo-recorder-verification-ambiguity-");
    const session = new InteractiveExplorationSession(
      launchConfig("ambiguity", baseUrl, outputDirectory, "read-only"),
    );
    try {
      const observation = await session.start();
      const target = observation.interactiveElements.find((element) =>
        element.target.candidates.some(
          (candidate) => candidate.by === "css" && candidate.selector === "#primary",
        ),
      );
      const transition = await session.act({
        type: "click",
        observationId: observation.id,
        ref: target?.ref ?? "missing",
      });
      expect(transition.status).toBe("succeeded");
      const verification = await session.verify({
        version: 1,
        transitionIds: [transition.id],
      });
      expect(verification.status).toBe("passed");
      expect(verification.steps[0]?.candidateUsed).toEqual({
        by: "css",
        selector: "#primary",
      });
    } finally {
      await session.close("finished");
    }
  }, 30_000);

  it("keeps a browser alive across separate session client calls", async () => {
    const app = await fixture();
    const root = await temporaryDirectory("demo-recorder-interactive-daemon-");
    const sessionRoot = join(root, "sessions");
    const outputDirectory = join(root, "output");
    const started = await startInteractiveSession({
      sessionRoot,
      config: launchConfig("persistent", app.baseUrl, outputDirectory, "reversible"),
    });
    expect(started.observation.id).toBe("obs-0001");

    const observed = await observeInteractiveSession(sessionRoot, "persistent");
    expect(observed.id).toBe("obs-0002");
    expect(observed.stateId).toBe(started.observation.stateId);
    const found = await findInInteractiveSession(sessionRoot, "persistent", {
      text: "create project",
    });
    expect(found.observationId).toBe(observed.id);
    expect(found.matches[0]?.ref).toBeDefined();
    const createProject = observed.interactiveElements.find(
      (element) => element.name === "Create project",
    );
    const transition = await actInInteractiveSession(sessionRoot, "persistent", {
      type: "click",
      observationId: observed.id,
      ref: createProject?.ref ?? "missing",
    });
    expect(transition.status).toBe("succeeded");
    expect(transition.toObservationId).toBe("obs-0003");
    const verification = await verifyInteractiveSession(sessionRoot, "persistent", {
      version: 1,
      transitionIds: [transition.id],
    });
    expect(verification.status).toBe("passed");

    const report = await finishInteractiveSession(sessionRoot, "persistent");
    expect(report.status).toBe("finished");
    expect(report.metrics.observations).toBe(3);
  }, 40_000);

  it("isolates named sessions, rejects duplicate starts, and replaces stale descriptors", async () => {
    const app = await fixture();
    const root = await temporaryDirectory("demo-recorder-session-isolation-");
    const sessionRoot = join(root, "sessions");
    await writeFile(
      join(root, "stale.json"),
      JSON.stringify({
        version: 1,
        id: "stale",
        pid: 999_999,
        port: 65_000,
        token: "stale-token",
        outputDirectory: join(root, "stale-output"),
        launchConfigPath: join(root, "stale.launch.json"),
      }),
    );
    await rm(sessionRoot, { recursive: true, force: true });
    const staleRoot = root;
    const stale = await startInteractiveSession({
      sessionRoot: staleRoot,
      config: launchConfig("stale", app.baseUrl, join(root, "stale-output"), "read-only"),
    });
    expect(stale.observation.id).toBe("obs-0001");
    await finishInteractiveSession(staleRoot, "stale");

    const firstConfig = launchConfig("isolated-a", app.baseUrl, join(root, "a"), "reversible");
    const secondConfig = launchConfig("isolated-b", app.baseUrl, join(root, "b"), "read-only");
    const [first, second] = await Promise.all([
      startInteractiveSession({ sessionRoot, config: firstConfig }),
      startInteractiveSession({ sessionRoot, config: secondConfig }),
    ]);
    try {
      await expect(startInteractiveSession({ sessionRoot, config: firstConfig })).rejects.toThrow(
        "already active",
      );
      const createProject = first.observation.interactiveElements.find(
        (element) => element.name === "Create project",
      );
      const changed = await actInInteractiveSession(sessionRoot, "isolated-a", {
        type: "click",
        observationId: first.observation.id,
        ref: createProject?.ref ?? "missing",
      });
      expect(changed.status).toBe("succeeded");
      const unchanged = await observeInteractiveSession(sessionRoot, "isolated-b");
      expect(unchanged.stateId).toBe(second.observation.stateId);
      expect(unchanged.headings).not.toContain("Summer campaign");
    } finally {
      await Promise.all([
        finishInteractiveSession(sessionRoot, "isolated-a").catch(() => undefined),
        finishInteractiveSession(sessionRoot, "isolated-b").catch(() => undefined),
      ]);
    }
  }, 60_000);

  it.runIf(process.platform !== "win32")(
    "stops a managed app even when its shell leader exits",
    async () => {
      const root = await temporaryDirectory("demo-recorder-managed-descendant-");
      const scriptPath = join(root, "server.mjs");
      const reservation = createServer();
      await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
      const address = reservation.address();
      if (!address || typeof address === "string") throw new Error("No reserved port");
      const port = address.port;
      await new Promise<void>((resolve, reject) =>
        reservation.close((error) => (error ? reject(error) : resolve())),
      );
      await writeFile(
        scriptPath,
        `import { createServer } from "node:http";\nconst server = createServer((_, response) => response.end("ready"));\nserver.listen(${port}, "127.0.0.1");\n`,
      );
      const readinessUrl = `http://127.0.0.1:${port}`;
      const managed = await startManagedApp({
        command: `${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)} &`,
        cwd: root,
        readinessUrl,
        timeoutMs: 10_000,
      });
      expect((await fetch(readinessUrl)).status).toBe(200);
      await managed.close();
      await expect(fetch(readinessUrl)).rejects.toThrow();
    },
    20_000,
  );
});
