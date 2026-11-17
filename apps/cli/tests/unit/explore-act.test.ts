import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { Action, ExplorationAction } from "@noice-tech/demo-recorder-core";
import type { PageInspection, Session } from "../../src/driver/types.js";
import { act } from "../../src/session/act.js";
import { observationPath } from "../../src/session/observe.js";
import { writeJsonAtomic } from "../../src/support/files.js";

const viewport = { width: 1440, height: 900 };
const directories: string[] = [];

const inspection: PageInspection = {
  url: "http://127.0.0.1:4173/",
  title: "Fixture",
  scroll: { x: 0, y: 0 },
  headings: ["Fixture"],
  elements: [
    {
      ref: "e1",
      role: "link",
      name: "Pricing",
      enabled: true,
      visible: true,
      bounds: { x: 10, y: 10, width: 80, height: 20 },
      risk: "read-only",
      target: { role: "link", name: "Pricing" },
      selector: "#pricing",
    },
  ],
  errors: [],
};

async function createProject(): Promise<string> {
  const project = await mkdtemp(join(tmpdir(), "demo-recorder-act-test-"));
  directories.push(project);
  await writeJsonAtomic(observationPath(project, "obs-0001"), {
    id: "obs-0001",
    createdAt: "2026-11-17T00:00:00.000Z",
    url: inspection.url,
    title: inspection.title,
    viewport,
    scroll: inspection.scroll,
    headings: inspection.headings,
    elements: inspection.elements,
    errors: [],
    artifacts: { snapshot: "observations/obs-0001.yml", screenshot: "observations/obs-0001.png" },
  });
  return project;
}

/** Like a smooth wheel scroll, a scroll lands only after a few position reads. */
function fakeSession(performed: Action[]): Session {
  const scroll = { x: 0, y: 0 };
  let pending: { y: number; reads: number } | undefined;
  const position = () => {
    if (pending && --pending.reads <= 0) {
      scroll.y = pending.y;
      pending = undefined;
    }
    return { ...scroll };
  };
  return {
    target: "fake",
    guarded: false,
    perform: (action: Action) => {
      performed.push(action);
      if (action.type === "scroll") pending = { y: scroll.y + action.deltaY, reads: 3 };
      return Promise.resolve();
    },
    scrollPosition: () => Promise.resolve(position()),
    countMatches: () => Promise.resolve(1),
    inspect: () => Promise.resolve({ ...inspection, scroll: position() }),
    snapshot: () => Promise.resolve('- link "Pricing"'),
    screenshot: () => Promise.resolve(),
  } as unknown as Session;
}

async function run(action: ExplorationAction) {
  const project = await createProject();
  const performed: Action[] = [];
  const result = await act({
    project,
    session: fakeSession(performed),
    policy: "read-only",
    lastObservationId: "obs-0001",
    nextObservationId: "obs-0002",
    action,
    viewport,
  });
  return { result, performed };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("explore act", () => {
  it.each<ExplorationAction>([
    { type: "scroll", deltaY: 400 },
    { type: "hold", durationMs: 250 },
    { type: "navigate", url: "http://127.0.0.1:4173/pricing" },
  ])("runs a ref-less $type action without an observationId", async (action) => {
    const { result, performed } = await run(action);
    expect(performed).toEqual([action]);
    expect(result.recordable).toBe(true);
    expect(result.observation.id).toBe("obs-0002");
  });

  it("observes a scroll where it lands, not where it started", async () => {
    const { result } = await run({ type: "scroll", deltaY: 400 });
    expect(result.observation.scroll).toEqual({ x: 0, y: 400 });
  });

  it("resolves a ref from the current observation", async () => {
    const { result, performed } = await run({
      type: "click",
      observationId: "obs-0001",
      ref: "e1",
    });
    expect(performed).toEqual([{ type: "click", target: { selector: "#pricing" } }]);
    expect(result.target).toEqual({ role: "link", name: "Pricing" });
  });

  it.each<ExplorationAction>([
    { type: "click", observationId: "obs-0000", ref: "e1" },
    { type: "press", key: "Enter", ref: "e1" },
  ])("rejects a ref that does not name the current observation", async (action) => {
    await expect(run(action)).rejects.toThrow(/must match the current observation \(obs-0001\)/);
  });

  it("still blocks off-origin navigation", async () => {
    await expect(run({ type: "navigate", url: "https://example.com/" })).rejects.toThrow(
      /Off-origin navigation is blocked/,
    );
  });
});
