import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  diffExplorationObservations,
  explorationSemanticFingerprint,
  materializeExplorationGraph,
  recoverExplorationGraph,
} from "../../src/explorer/graph.js";
import type {
  ExplorationObservation,
  ExplorationTransition,
} from "../../src/explorer/interactive-schema.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function observation(
  sequence: number,
  stateId: string,
  options: { heading?: string; selected?: boolean } = {},
): ExplorationObservation {
  const id = `obs-${sequence}`;
  const heading = options.heading ?? "Overview";
  return {
    schemaVersion: 2,
    id,
    sequence,
    stateId,
    reason: sequence === 1 ? "initial" : "agent-request",
    createdAt: "2026-01-01T00:00:00.000Z",
    url: "https://example.com/",
    pathname: "/",
    title: "Example",
    viewport: { width: 1440, height: 900 },
    scroll: { x: 0, y: 0 },
    headings: [heading],
    layers: [],
    interactiveElements: [
      {
        ref: "e1",
        role: "tab",
        name: "Overview",
        tagName: "BUTTON",
        visible: true,
        enabled: true,
        ...(options.selected === undefined ? {} : { selected: options.selected }),
        bounds: { x: 0, y: 0, width: 100, height: 40 },
        risk: "read-only",
        riskReasons: ["Tab"],
        target: {
          description: "tab Overview",
          candidates: [{ by: "role", role: "tab", name: "Overview", exact: true }],
          expected: { role: "tab", accessibleName: "Overview", count: 1 },
        },
      },
    ],
    errors: [],
    artifacts: {
      snapshot: `snapshots/${id}.yml`,
      screenshot: `screenshots/${id}.png`,
      observation: `observations/${id}.json`,
    },
    semanticFingerprint: explorationSemanticFingerprint(
      "/",
      `- heading "${heading}"\n- tab "Overview"${options.selected ? " [selected]" : ""}`,
    ),
    settled: { reason: sequence === 1 ? "initial" : "quiet", durationMs: 100 },
  };
}

function transition(
  before: ExplorationObservation,
  after: ExplorationObservation,
): ExplorationTransition {
  return {
    schemaVersion: 2,
    id: "transition-1",
    sequence: 1,
    createdAt: "2026-01-01T00:00:01.000Z",
    action: { type: "click", observationId: before.id, ref: "e1" },
    status: "succeeded",
    policy: { allowed: true, risk: "read-only", reasons: ["Tab"] },
    fromObservationId: before.id,
    fromStateId: before.stateId,
    toObservationId: after.id,
    toStateId: after.stateId,
    diff: diffExplorationObservations(before, after),
    outcome: {
      urlChanged: false,
      semanticChanged: true,
      popupBlocked: false,
      downloadBlocked: false,
      dialogDismissed: false,
      settledReason: "quiet",
    },
    durationMs: 200,
  };
}

describe("exploration graph", () => {
  it("materializes aliases without discarding equivalent observations", () => {
    const first = observation(1, "state-1");
    const repeated = {
      ...observation(2, "state-1"),
      semanticFingerprint: first.semanticFingerprint,
    };
    const graph = materializeExplorationGraph([first, repeated], []);
    expect(graph.states).toEqual([
      {
        id: "state-1",
        fingerprint: first.semanticFingerprint,
        canonicalObservationId: "obs-1",
        observationIds: ["obs-1", "obs-2"],
      },
    ]);
    expect(graph.observations).toHaveLength(2);
  });

  it("records explicit semantic additions and removals", () => {
    const before = observation(1, "state-1", { selected: false });
    const after = observation(2, "state-2", { heading: "Details", selected: true });
    const diff = diffExplorationObservations(before, after);
    expect(diff.headingsAdded).toEqual(["Details"]);
    expect(diff.headingsRemoved).toEqual(["Overview"]);
    expect(diff.controlsAdded[0]).toContain("true");
    expect(diff.controlsRemoved[0]).toContain("false");
  });

  it("recovers the graph from append-only observation and transition journals", async () => {
    const root = await mkdtemp(join(tmpdir(), "demo-recorder-graph-"));
    roots.push(root);
    const before = observation(1, "state-1");
    const after = observation(2, "state-2", { heading: "Details" });
    const edge = transition(before, after);
    await Promise.all([
      writeFile(
        join(root, "observations.ndjson"),
        `${JSON.stringify(before)}\n${JSON.stringify(after)}\n`,
      ),
      writeFile(join(root, "transitions.ndjson"), `${JSON.stringify(edge)}\n`),
    ]);
    const graph = await recoverExplorationGraph(
      join(root, "observations.ndjson"),
      join(root, "transitions.ndjson"),
    );
    expect(graph.states.map((state) => state.id)).toEqual(["state-1", "state-2"]);
    expect(graph.transitions).toEqual([
      {
        id: "transition-1",
        status: "succeeded",
        fromStateId: "state-1",
        toStateId: "state-2",
      },
    ]);
  });
});
