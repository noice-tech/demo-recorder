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

const SPRING_RESPONSE = 6;
const SPRING_NORMALIZATION = 1 - (1 + SPRING_RESPONSE) * Math.exp(-SPRING_RESPONSE);

/** A normalized critically damped spring: fast to focus, then gently settles. */
const springStep = (progress: number): number => {
  const clamped = Math.min(1, Math.max(0, progress));
  return (
    (1 - (1 + SPRING_RESPONSE * clamped) * Math.exp(-SPRING_RESPONSE * clamped)) /
    SPRING_NORMALIZATION
  );
};

const joined = (left: ZoomSegment | undefined, right: ZoomSegment | undefined): boolean =>
  Boolean(left && right && Math.abs(left.endMs - right.startMs) < 0.001);

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
  previous: ZoomSegment | undefined,
  next: ZoomSegment | undefined,
  enterDurationMs: number,
  exitDurationMs: number,
): number {
  const segmentDuration = Math.max(0, segment.endMs - segment.startMs);
  const { enterMs, exitMs } = transitionDurations(segmentDuration, enterDurationMs, exitDurationMs);
  const exitStart = segment.endMs - exitMs;

  if (enterMs > 0 && timestampMs < segment.startMs + enterMs) {
    const progress = (timestampMs - segment.startMs) / enterMs;
    const initialScale = joined(previous, segment) ? previous!.scale : 1;
    return initialScale + (segment.scale - initialScale) * springStep(progress);
  }
  if (!joined(segment, next) && exitMs > 0 && timestampMs > exitStart) {
    const progress = (timestampMs - exitStart) / exitMs;
    return segment.scale - (segment.scale - 1) * springStep(progress);
  }
  return segment.scale;
}

export function cameraStateAt(input: CameraStateInput): CameraState {
  const neutralOrigin = {
    x: input.contentRect.x + input.contentRect.width / 2,
    y: input.contentRect.y + input.contentRect.height / 2,
  };
  const segmentIndex = input.segments.findIndex(
    ({ startMs, endMs }) => input.timestampMs >= startMs && input.timestampMs <= endMs,
  );
  const segment = input.segments[segmentIndex];

  if (!segment) {
    return {
      scale: 1,
      originX: neutralOrigin.x,
      originY: neutralOrigin.y,
    };
  }

  const previous = input.segments[segmentIndex - 1];
  const next = input.segments[segmentIndex + 1];
  const targetOrigin = projectViewportPoint(
    { x: segment.focusX, y: segment.focusY },
    input.viewport,
    input.contentRect,
  );
  let origin = targetOrigin;
  if (joined(previous, segment) && input.enterDurationMs > 0) {
    const enterMs = transitionDurations(
      segment.endMs - segment.startMs,
      input.enterDurationMs,
      input.exitDurationMs,
    ).enterMs;
    if (enterMs > 0 && input.timestampMs < segment.startMs + enterMs) {
      const sourceOrigin = projectViewportPoint(
        { x: previous!.focusX, y: previous!.focusY },
        input.viewport,
        input.contentRect,
      );
      const progress = springStep((input.timestampMs - segment.startMs) / enterMs);
      origin = {
        x: sourceOrigin.x + (targetOrigin.x - sourceOrigin.x) * progress,
        y: sourceOrigin.y + (targetOrigin.y - sourceOrigin.y) * progress,
      };
    }
  }

  return {
    scale: scaleAt(
      input.timestampMs,
      segment,
      previous,
      next,
      input.enterDurationMs,
      input.exitDurationMs,
    ),
    originX: origin.x,
    originY: origin.y,
    activeSegment: segment,
  };
}
