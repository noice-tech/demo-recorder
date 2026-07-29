import { describe, expect, it } from "vitest";
import {
  explorationObservationSchema,
  type ExploredInteractiveElementV2,
} from "../../src/explorer/interactive-schema.js";
import { summarizeExplorationObservation } from "../../src/explorer/observation-summary.js";

function element(ref: string, name: string, y: number): ExploredInteractiveElementV2 {
  return {
    ref,
    role: "button",
    name,
    tagName: "BUTTON",
    visible: true,
    enabled: true,
    bounds: { x: 20, y, width: 120, height: 40 },
    risk: "read-only",
    riskReasons: ["Presentational control"],
    target: {
      description: `button "${name}"`,
      candidates: [{ by: "role", role: "button", name, exact: true }],
      expected: { role: "button", accessibleName: name },
    },
  };
}

describe("exploration observation summaries", () => {
  it("returns viewport controls and points to the complete observation artifact", () => {
    const observation = explorationObservationSchema.parse({
      schemaVersion: 2,
      id: "obs-0001",
      sequence: 1,
      stateId: "state-0001",
      reason: "initial",
      createdAt: "2026-01-01T00:00:00.000Z",
      url: "https://example.com/",
      pathname: "/",
      title: "Example",
      viewport: { width: 1440, height: 900 },
      scroll: { x: 0, y: 0 },
      headings: ["Example"],
      layers: [],
      interactiveElements: [
        element("e1", "Visible control", 100),
        element("e2", "Offscreen control", 1_200),
      ],
      errors: [],
      artifacts: {
        snapshot: "snapshots/obs-0001.yml",
        screenshot: "screenshots/obs-0001.png",
        observation: "observations/obs-0001.json",
      },
      semanticFingerprint: "fingerprint",
      settled: { reason: "initial", durationMs: 200 },
    });
    const summary = summarizeExplorationObservation(observation);
    expect(summary.interactiveElements.map((candidate) => candidate.name)).toEqual([
      "Visible control",
    ]);
    expect(summary.interactiveElementCounts).toEqual({ total: 2, viewport: 1, returned: 1 });
    expect(summary.artifacts.observation).toBe("observations/obs-0001.json");
  });
});
