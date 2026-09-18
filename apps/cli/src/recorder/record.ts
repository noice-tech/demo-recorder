import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Action, Plan, Recording } from "@noice-tech/demo-recorder-core";
import type { Session } from "../driver/types.js";
import { generateCursorPath, type CursorPoint } from "../motion/cursor.js";
import { normalizeKeyChord } from "../motion/keys.js";
import { smoothScroll } from "../motion/scroll.js";
import { executePlan, type PlanSession, type PlanStepReport } from "../runner.js";
import { writeJsonAtomic } from "../support/files.js";
import { createEventLog } from "./events.js";

const sleep = (durationMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

export type RecordResult = {
  recording: Recording;
  steps: PlanStepReport[];
  videoPath: string;
  eventsPath: string;
};

function centerOf(bounds: { x: number; y: number; width: number; height: number }): CursorPoint {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

/** Runs a plan with a live capture and returns immutable recording facts. */
export async function recordPlan(input: {
  plan: Plan;
  session: Session;
  project: string;
  guarded: boolean;
}): Promise<RecordResult> {
  const { plan, session, project, guarded } = input;
  const recordingDirectory = join(project, "recording");
  await mkdir(recordingDirectory, { recursive: true });
  const temporaryVideo = join(recordingDirectory, `browser.${process.pid}.tmp.mp4`);
  const finalVideo = join(recordingDirectory, "browser.mp4");

  const capture = await session.startCapture(temporaryVideo);
  const log = createEventLog(capture.startedAtNs);
  let pointer: CursorPoint = { x: plan.viewport.width / 2, y: plan.viewport.height / 2 };
  let lastUrl = plan.target.baseUrl;

  const logNavigationIfChanged = async (): Promise<void> => {
    const current = await session.url().catch(() => undefined);
    if (current && current !== lastUrl) {
      lastUrl = current;
      log.push({ type: "navigation", url: current });
    }
  };

  const moveTo = async (point: CursorPoint): Promise<void> => {
    const path = generateCursorPath(pointer, point, { viewport: plan.viewport });
    const interval = path.points.length > 0 ? path.durationMs / path.points.length : 0;
    for (const step of path.points) {
      await session.mouseMove(step.x, step.y);
      log.push({ type: "cursor-move", x: step.x, y: step.y });
      if (interval > 0) await sleep(interval);
    }
    pointer = point;
  };

  const recordAction = async (action: Action): Promise<void> => {
    if (action.type === "navigate") {
      log.push({ type: "navigation", url: action.url });
      await session.perform(action);
      return;
    }
    if (action.type === "hold") {
      await session.perform(action);
      return;
    }
    if (action.type === "scroll") {
      const deltaX = action.deltaX ?? 0;
      log.push({ type: "scroll", deltaX, deltaY: action.deltaY });
      await smoothScroll(
        {
          wheel: (x, y) => session.perform({ type: "scroll", deltaX: x, deltaY: y }),
          waitForTimeout: sleep,
        },
        action.deltaY,
        deltaX,
      );
      return;
    }

    const target = "target" in action ? action.target : undefined;
    const bounds = target ? await session.bounds(target) : undefined;
    if (bounds) await moveTo(centerOf(bounds));
    if (action.type === "click") {
      log.push({
        type: "click",
        x: pointer.x,
        y: pointer.y,
        button: "left",
        ...(bounds ? { target: { bounds } } : {}),
      });
    } else if (action.type === "press") {
      log.push({ type: "key-press", keys: normalizeKeyChord(action.key) });
    }
    await session.perform(action);
    await logNavigationIfChanged();
  };

  const planSession: PlanSession = {
    perform: recordAction,
    waitFor: async (expect) => {
      await session.waitFor(expect);
      await logNavigationIfChanged();
    },
    url: () => session.url(),
  };

  try {
    log.push({ type: "navigation", url: plan.target.baseUrl });
    await session.goto(plan.target.baseUrl);
    const steps = await executePlan({
      plan,
      session: planSession,
      beforeStep: (stepNumber) => log.setStep(stepNumber),
    });
    const { durationMs } = await capture.stop();
    await rename(temporaryVideo, finalVideo);

    const recording: Recording = {
      version: 1,
      id: `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${Math.random().toString(16).slice(2, 10)}`,
      createdAt: new Date().toISOString(),
      durationMs,
      viewport: plan.viewport,
      guarded,
      cursor: "synthetic",
      video: { path: "browser.mp4", width: plan.viewport.width, height: plan.viewport.height },
      events: log.events(),
    };
    const eventsPath = join(recordingDirectory, "events.json");
    await writeJsonAtomic(eventsPath, recording);
    return { recording, steps, videoPath: finalVideo, eventsPath };
  } catch (error) {
    await capture.abort();
    await rm(temporaryVideo, { force: true }).catch(() => undefined);
    throw error;
  }
}
