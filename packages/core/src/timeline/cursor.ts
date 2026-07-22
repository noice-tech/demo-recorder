import type { CursorMoveEvent, RecordingEvent } from "../recording/types.js";

export type CursorPosition = { x: number; y: number };

export function cursorPositionAt(
  events: readonly RecordingEvent[],
  timestampMs: number,
): CursorPosition | undefined {
  const moves = events.filter((event): event is CursorMoveEvent => event.type === "cursor-move");
  const nextIndex = moves.findIndex((event) => event.timestampMs >= timestampMs);
  if (nextIndex === 0) return moves[0];
  if (nextIndex < 0) return moves.at(-1);

  const before = moves[nextIndex - 1];
  const after = moves[nextIndex];
  if (!before || !after) return before ?? after;
  const span = after.timestampMs - before.timestampMs;
  const progress = span === 0 ? 1 : (timestampMs - before.timestampMs) / span;
  return {
    x: before.x + (after.x - before.x) * progress,
    y: before.y + (after.y - before.y) * progress,
  };
}
