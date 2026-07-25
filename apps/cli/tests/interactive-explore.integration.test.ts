import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  type ExplorationLaunchConfig,
} from "../src/explorer/index.js";
import { startFixtureServer, type FixtureServer } from "./support/fixture-server.js";

const fixtureDirectory = fileURLToPath(new URL("fixtures/example-app", import.meta.url));
const temporaryDirectories: string[] = [];
const fixtures: FixtureServer[] = [];

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
      expect(session.report().metrics.observations).toBe(1);
    } finally {
      await session.close("finished");
    }
  }, 30_000);

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
      expect(session.report().metrics.observations).toBe(2);

      await expect(
        session.act({
          type: "click",
          observationId: observation.id,
          ref: createProject?.ref ?? "missing",
        }),
      ).rejects.toThrow("Stale observation reference");
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

    const report = await finishInteractiveSession(sessionRoot, "persistent");
    expect(report.status).toBe("finished");
    expect(report.metrics.observations).toBe(3);
  }, 40_000);

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
