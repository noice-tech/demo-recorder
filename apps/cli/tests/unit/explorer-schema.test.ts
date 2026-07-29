import { describe, expect, it } from "vitest";
import {
  explorationActionSchema,
  explorationFindQuerySchema,
  explorationLaunchConfigSchema,
  explorationObservationSchema,
  explorationVerificationRequestSchema,
} from "../../src/explorer/interactive-schema.js";

const launchConfig = {
  version: 1,
  id: "schema-test",
  baseUrl: "https://example.com",
  outputDirectory: "/tmp/schema-test",
  headless: true,
  policy: "read-only",
  maxActions: 20,
  maxDurationMs: 60_000,
} as const;

const observation = {
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
  interactiveElements: [],
  errors: [],
  artifacts: {
    snapshot: "snapshots/obs-0001.yml",
    screenshot: "screenshots/obs-0001.png",
    observation: "observations/obs-0001.json",
  },
  semanticFingerprint: "fingerprint",
  settled: { reason: "initial", durationMs: 200 },
} as const;

describe("interactive exploration schemas", () => {
  it("accepts bounded launch configuration and rejects unsupported versions", () => {
    expect(explorationLaunchConfigSchema.parse(launchConfig)).toEqual(launchConfig);
    expect(() => explorationLaunchConfigSchema.parse({ ...launchConfig, version: 2 })).toThrow();
    expect(() =>
      explorationLaunchConfigSchema.parse({ ...launchConfig, maxActions: 501 }),
    ).toThrow();
  });

  it("rejects unsupported observation artifact versions", () => {
    expect(explorationObservationSchema.parse(observation)).toEqual(observation);
    expect(() =>
      explorationObservationSchema.parse({ ...observation, schemaVersion: 1 }),
    ).toThrow();
  });

  it("requires exactly one bounded find query", () => {
    expect(explorationFindQuerySchema.parse({ text: "pricing" })).toEqual({ text: "pricing" });
    expect(() => explorationFindQuerySchema.parse({})).toThrow(/exactly one/);
    expect(() => explorationFindQuerySchema.parse({ text: "pricing", regex: "price" })).toThrow(
      /exactly one/,
    );
  });

  it("requires a nonempty unique verification path", () => {
    expect(
      explorationVerificationRequestSchema.parse({
        version: 1,
        transitionIds: ["transition-1", "transition-2"],
      }),
    ).toEqual({ version: 1, transitionIds: ["transition-1", "transition-2"] });
    expect(() =>
      explorationVerificationRequestSchema.parse({ version: 1, transitionIds: [] }),
    ).toThrow();
    expect(() =>
      explorationVerificationRequestSchema.parse({
        version: 1,
        transitionIds: ["transition-1", "transition-1"],
      }),
    ).toThrow(/unique/);
  });

  it("rejects unbounded waits and accepts finite scroll actions", () => {
    expect(explorationActionSchema.parse({ type: "scroll", deltaY: 500 })).toEqual({
      type: "scroll",
      deltaX: 0,
      deltaY: 500,
    });
    expect(() => explorationActionSchema.parse({ type: "wait", durationMs: 10_001 })).toThrow();
    expect(() => explorationActionSchema.parse({ type: "scroll", deltaY: Number.NaN })).toThrow();
  });
});
