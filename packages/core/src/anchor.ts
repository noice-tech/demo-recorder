import type { Anchor } from "./presentation.js";
import type { ClickEvent, CursorMoveEvent, Recording, RecordingEvent } from "./recording.js";

export type InteractionPoint = { x: number; y: number };

function eventsForStep(recording: Recording, step: number): RecordingEvent[] {
  return recording.events.filter((event) => event.step === step);
}

const decisiveEventOrder = ["click", "key-press", "scroll", "navigation"] as const;

/**
 * The time of the step's decisive action. Generated cursor motion shares a
 * step with the click it precedes, so it must not define the anchor.
 */
export function stepTimeMs(recording: Recording, step: number): number {
  const events = eventsForStep(recording, step);
  if (events.length === 0) {
    throw new Error(`Cannot resolve anchor: step ${step} has no recorded events`);
  }
  for (const type of decisiveEventOrder) {
    const decisive = events.find((event) => event.type === type);
    if (decisive) return decisive.timestampMs;
  }
  return events[0]!.timestampMs;
}

/** The point a step acted on, used as a zoom focus. */
export function stepInteractionPoint(
  recording: Recording,
  step: number,
): InteractionPoint | undefined {
  const events = eventsForStep(recording, step);
  const click = events.find((event): event is ClickEvent => event.type === "click");
  if (click) return { x: click.x, y: click.y };
  const move = events.find((event): event is CursorMoveEvent => event.type === "cursor-move");
  if (move) return { x: move.x, y: move.y };
  return undefined;
}

/** Turns a step or edge anchor into absolute milliseconds on the recording clock. */
export function resolveAnchorMs(anchor: Anchor, recording: Recording): number {
  if ("anchor" in anchor) return anchor.anchor === "start" ? 0 : recording.durationMs;
  return stepTimeMs(recording, anchor.step) + (anchor.offsetMs ?? 0);
}
