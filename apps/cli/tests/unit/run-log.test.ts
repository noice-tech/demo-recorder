import { describe, expect, it } from "vitest";
import { summarizeRun, type RunLogEntry } from "../../src/support/run-log.js";

const at = (seconds: number) => new Date(Date.UTC(2026, 10, 17, 12, 0, seconds));

function entry(runId: string, command: string, startS: number, durationS: number, ok = true) {
  return {
    runId,
    command,
    startedAt: at(startS).toISOString(),
    durationMs: durationS * 1_000,
    ok,
  } satisfies RunLogEntry;
}

const record = { startedAt: at(40), finishedAt: at(55), captureMs: 6_000, renderMs: 9_000 };

describe("summarizeRun", () => {
  it("measures only the recording's own run, up to the recording", () => {
    const summary = summarizeRun({
      runId: "run-2",
      entries: [
        // An earlier run in the same project, including a failed recording.
        entry("run-1", "explore start", 0, 1),
        entry("run-1", "record", 2, 3, false),
        entry("run-2", "explore start", 10, 1),
        entry("run-2", "explore act", 12, 1),
        entry("run-2", "explore finish", 14, 1),
        entry("run-2", "plan rehearse", 20, 5, false),
        entry("run-2", "plan rehearse", 30, 5),
        // Logged after the recording started, so not part of what led to it.
        entry("run-2", "render", 60, 5),
      ],
      record,
    });

    expect(summary).toEqual({
      runId: "run-2",
      startedAt: at(10).toISOString(),
      finishedAt: at(55).toISOString(),
      metrics: {
        explorationMs: 5_000,
        planningMs: 5_000,
        rehearsalMs: 20_000,
        captureMs: 6_000,
        renderMs: 9_000,
        totalMs: 45_000,
        toolMs: 28_000,
        exploreActions: 1,
        rehearsals: 2,
        repairAttempts: 1,
      },
    });
  });

  it("leaves out phases a run skipped", () => {
    const summary = summarizeRun({ runId: "run-3", entries: [], record });
    expect(summary.metrics).toEqual({
      captureMs: 6_000,
      renderMs: 9_000,
      totalMs: 15_000,
      toolMs: 15_000,
      exploreActions: 0,
      rehearsals: 0,
      repairAttempts: 0,
    });
  });
});
