import type { Viewport } from "../recording/types.js";
import { projectViewportPoint, type Rect } from "./layout.js";
import type { ZoomSegment } from "./types.js";

export type CameraState = {
  scale: number;
  originX: number;
  originY: number;
  activeSegment?: ZoomSegment;
};

type CameraStateInput = {
  timestampMs: number;
  segments: readonly ZoomSegment[];
  viewport: Pick<Viewport, "width" | "height">;
  contentRect: Rect;
  enterDurationMs: number;
  exitDurationMs: number;
};

const smoothStep = (progress: number): number => {
  const clamped = Math.min(1, Math.max(0, progress));
  return clamped * clamped * (3 - 2 * clamped);
};

function transitionDurations(
  segmentDurationMs: number,
  enterDurationMs: number,
  exitDurationMs: number,
): { enterMs: number; exitMs: number } {
  const safeEnter = Math.max(0, enterDurationMs);
  const safeExit = Math.max(0, exitDurationMs);
  const total = safeEnter + safeExit;
  if (total === 0 || total <= segmentDurationMs) {
    return { enterMs: safeEnter, exitMs: safeExit };
  }

  const ratio = segmentDurationMs / total;
  return { enterMs: safeEnter * ratio, exitMs: safeExit * ratio };
}

function scaleAt(
  timestampMs: number,
  segment: ZoomSegment,
  enterDurationMs: number,
  exitDurationMs: number,
): number {
  const segmentDuration = Math.max(0, segment.endMs - segment.startMs);
  const { enterMs, exitMs } = transitionDurations(segmentDuration, enterDurationMs, exitDurationMs);
  const exitStart = segment.endMs - exitMs;

  if (enterMs > 0 && timestampMs < segment.startMs + enterMs) {
    const progress = (timestampMs - segment.startMs) / enterMs;
    return 1 + (segment.scale - 1) * smoothStep(progress);
  }
  if (exitMs > 0 && timestampMs > exitStart) {
    const progress = (timestampMs - exitStart) / exitMs;
    return segment.scale - (segment.scale - 1) * smoothStep(progress);
  }
  return segment.scale;
}

export function cameraStateAt(input: CameraStateInput): CameraState {
  const neutralOrigin = {
    x: input.contentRect.x + input.contentRect.width / 2,
    y: input.contentRect.y + input.contentRect.height / 2,
  };
  const segment = input.segments.find(
    ({ startMs, endMs }) => input.timestampMs >= startMs && input.timestampMs <= endMs,
  );

  if (!segment) {
    return {
      scale: 1,
      originX: neutralOrigin.x,
      originY: neutralOrigin.y,
    };
  }

  const origin = projectViewportPoint(
    { x: segment.focusX, y: segment.focusY },
    input.viewport,
    input.contentRect,
  );

  return {
    scale: scaleAt(input.timestampMs, segment, input.enterDurationMs, input.exitDurationMs),
    originX: origin.x,
    originY: origin.y,
    activeSegment: segment,
  };
}
