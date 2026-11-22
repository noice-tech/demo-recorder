import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * One finished CLI command. `DIR/run-log.jsonl` keeps one per line, so a run can
 * be reconstructed without any command holding state for another.
 */
export type RunLogEntry = {
  runId: string;
  command: string;
  startedAt: string;
  durationMs: number;
  ok: boolean;
  /** Stopped by a signal (Ctrl-C, or a harness timeout), so neither a success nor a failure. */
  interrupted?: true;
};

/** Commands that make up a demo run; `explore start` begins a new one. */
export const RUN_COMMANDS = new Set([
  "explore start",
  "explore observe",
  "explore act",
  "explore finish",
  "auth start",
  "auth save",
  "plan rehearse",
  "record",
  "render",
]);

export function runLogPath(project: string): string {
  return join(project, "run-log.jsonl");
}

export async function readRunLog(project: string): Promise<RunLogEntry[]> {
  const text = await readFile(runLogPath(project), "utf8").catch(() => "");
  return text
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        // SAFETY: appendRunLog is the only writer of this file.
        return [JSON.parse(line) as RunLogEntry];
      } catch {
        return [];
      }
    });
}

function newRunId(startedAt: Date): string {
  return `run-${startedAt.toISOString().replaceAll(/[:.]/g, "-")}`;
}

/** The run a command belongs to: a new one for `explore start`, otherwise the latest. */
export async function runIdFor(project: string, command: string, startedAt: Date): Promise<string> {
  if (command === "explore start") {
    return newRunId(startedAt);
  }
  return (await readRunLog(project)).at(-1)?.runId ?? newRunId(startedAt);
}

export async function appendRunLog(project: string, entry: RunLogEntry): Promise<void> {
  await mkdir(project, { recursive: true });
  await appendFile(runLogPath(project), `${JSON.stringify(entry)}\n`);
}

export type RunSummary = {
  runId: string;
  startedAt: string;
  finishedAt: string;
  metrics: {
    /** Wall time from `explore start` to the last explore command. */
    explorationMs?: number;
    /** Wall time from the end of exploration to the first rehearsal (or capture). */
    planningMs?: number;
    /** Wall time from the first rehearsal to the start of `record`, repairs included. */
    rehearsalMs?: number;
    captureMs: number;
    renderMs: number;
    /** Whole run, agent time included. */
    totalMs: number;
    /** Time spent inside Demo Recorder commands; the rest is the agent's. */
    toolMs: number;
    exploreActions: number;
    rehearsals: number;
    /** Failed rehearsals and recordings before this recording. */
    repairAttempts: number;
    /** Commands stopped by a signal; they count as neither success nor repair. */
    interrupted: number;
    /** Recordings in this run, this one included. */
    recordings: number;
    /** From the start of the run to the end of its first successful recording. */
    firstVideoMs: number;
    /** From the first successful recording to the end of this one; 0 when this is the first. */
    polishMs: number;
  };
};

const endOf = (entry: RunLogEntry): number => Date.parse(entry.startedAt) + entry.durationMs;
const startOf = (entry: RunLogEntry): number => Date.parse(entry.startedAt);

/**
 * Summarizes the run a recording belongs to from the commands logged before it
 * and the recording's own capture and render times.
 */
export function summarizeRun(input: {
  runId: string;
  entries: RunLogEntry[];
  record: { startedAt: Date; finishedAt: Date; captureMs: number; renderMs: number };
}): RunSummary {
  const { record } = input;
  const recordStart = record.startedAt.getTime();
  const entries = input.entries.filter(
    (entry) => entry.runId === input.runId && startOf(entry) < recordStart,
  );
  const explore = entries.filter((entry) => entry.command.startsWith("explore "));
  const rehearsals = entries.filter((entry) => entry.command === "plan rehearse");
  const runStart = Math.min(recordStart, ...entries.map(startOf));

  const explorationEnd = explore.length > 0 ? Math.max(...explore.map(endOf)) : undefined;
  const firstRehearsal = rehearsals.length > 0 ? Math.min(...rehearsals.map(startOf)) : undefined;
  const explorationMs =
    explorationEnd === undefined ? undefined : explorationEnd - Math.min(...explore.map(startOf));
  const planningMs =
    explorationEnd === undefined
      ? undefined
      : Math.max(0, (firstRehearsal ?? recordStart) - explorationEnd);
  const rehearsalMs = firstRehearsal === undefined ? undefined : recordStart - firstRehearsal;
  const recordMs = record.finishedAt.getTime() - recordStart;
  const records = entries.filter((entry) => entry.command === "record");
  const firstVideo = records.find((entry) => entry.ok);
  const firstVideoEnd = firstVideo ? endOf(firstVideo) : record.finishedAt.getTime();

  return {
    runId: input.runId,
    startedAt: new Date(runStart).toISOString(),
    finishedAt: record.finishedAt.toISOString(),
    metrics: {
      ...(explorationMs === undefined ? {} : { explorationMs }),
      ...(planningMs === undefined ? {} : { planningMs }),
      ...(rehearsalMs === undefined ? {} : { rehearsalMs }),
      captureMs: record.captureMs,
      renderMs: record.renderMs,
      totalMs: record.finishedAt.getTime() - runStart,
      toolMs: entries.reduce((sum, entry) => sum + entry.durationMs, 0) + recordMs,
      exploreActions: explore.filter((entry) => entry.command === "explore act").length,
      rehearsals: rehearsals.length,
      repairAttempts: entries.filter(
        (entry) =>
          !entry.ok &&
          !entry.interrupted &&
          (entry.command === "plan rehearse" || entry.command === "record"),
      ).length,
      interrupted: entries.filter((entry) => entry.interrupted).length,
      recordings: records.length + 1,
      firstVideoMs: firstVideoEnd - runStart,
      polishMs: record.finishedAt.getTime() - firstVideoEnd,
    },
  };
}
