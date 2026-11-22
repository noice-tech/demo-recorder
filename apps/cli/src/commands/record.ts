import { join, resolve } from "node:path";
import { parsePlan, type Plan } from "@noice-tech/demo-recorder-core";
import { selectDriver } from "../driver/index.js";
import { recordPlan } from "../recorder/record.js";
import { renderDemoVideo } from "../renderer/index.js";
import {
  booleanOption,
  stringOption,
  type OptionDefinitions,
  type ParsedArguments,
} from "../support/args.js";
import { readJson, writeJsonAtomic } from "../support/files.js";
import { requirePresentationFits } from "../renderer/prepare-recording.js";
import { readRunLog, runIdFor, summarizeRun } from "../support/run-log.js";
import { planDigest } from "../support/rehearsal.js";
import { requireFfmpegAssets } from "../support/ffmpeg.js";

export const recordOptions: OptionDefinitions = {
  project: { type: "string" },
  plan: { type: "string" },
  driver: { type: "string" },
  headed: { type: "boolean" },
  "allow-unguarded": { type: "boolean" },
  "skip-rehearsal": { type: "boolean" },
  "storage-state": { type: "string" },
  output: { type: "string" },
};

type RehearsalReport = {
  ok?: boolean;
  captureReady?: boolean;
  plan?: string;
  planDigest?: string;
};

async function requireRehearsal(project: string, planPath: string, plan: Plan): Promise<void> {
  const report = await readJson(join(project, "rehearsal-report.json")).then(
    (value) => value as RehearsalReport,
    () => undefined,
  );
  if (
    !report?.ok ||
    !report.captureReady ||
    !report.plan ||
    resolve(report.plan) !== planPath ||
    report.planDigest !== planDigest(plan)
  ) {
    throw new Error(
      `No passing rehearsal for the current plan at ${planPath}. Run \`plan rehearse --project ${project} --plan ${planPath}\` first, or explicitly bypass with --skip-rehearsal.`,
    );
  }
}

export async function runRecord(args: ParsedArguments): Promise<unknown> {
  const startedAt = new Date();
  const project = resolve(stringOption(args, "project") ?? ".");
  const planPath = resolve(
    stringOption(args, "plan") ?? args.positionals[0] ?? join(project, "plan.json"),
  );
  const plan = parsePlan(await readJson(planPath));
  // Styling edits keep the rehearsal valid, so check them again before capture.
  await requirePresentationFits(project, plan);

  if (!booleanOption(args, "skip-rehearsal")) await requireRehearsal(project, planPath, plan);

  // Capture time includes launching the browser for the recording.
  const captureStart = performance.now();
  const driver = selectDriver(stringOption(args, "driver") ?? "playwright");
  const storageStatePath = stringOption(args, "storage-state");
  const session = await driver.connect({
    mode: "launched",
    headless: !booleanOption(args, "headed"),
    viewport: plan.viewport,
    ...(storageStatePath ? { storageStatePath } : {}),
  });

  try {
    const guarded = session.guarded;
    if (!guarded && !booleanOption(args, "allow-unguarded")) {
      throw new Error(
        "The runtime effect boundary is not available for this driver. Pass --allow-unguarded to record without it.",
      );
    }
    const captured = await recordPlan({ plan, session, project, guarded });
    const renderStart = performance.now();
    const rendered = await renderDemoVideo(join(project, "recording"), {
      assetsDirectory: requireFfmpegAssets(),
      outputPath: resolve(stringOption(args, "output") ?? join(project, "output.mp4")),
      presentationPath: join(project, "presentation.json"),
      overwrite: true,
    });
    const renderEnd = performance.now();

    const run = summarizeRun({
      runId: await runIdFor(project, "record", startedAt),
      entries: await readRunLog(project),
      record: {
        startedAt,
        finishedAt: new Date(),
        captureMs: Math.round(renderStart - captureStart),
        renderMs: Math.round(renderEnd - renderStart),
      },
    });
    const runPath = join(project, "run.json");
    await writeJsonAtomic(runPath, run);
    return {
      recording: captured.videoPath,
      events: captured.eventsPath,
      output: rendered.outputPath,
      steps: captured.steps.length,
      zooms: rendered.zoomSegmentCount,
      run: runPath,
      metrics: run.metrics,
    };
  } finally {
    await session.close();
  }
}
