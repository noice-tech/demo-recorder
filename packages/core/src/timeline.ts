import { resolveAnchorMs, stepInteractionPoint, stepTimeMs } from "./anchor.js";
import type { Presentation, RenderConfig, Trim, Zoom } from "./presentation.js";
import type {
  ClickEvent,
  CursorMoveEvent,
  Recording,
  RecordingEvent,
  Viewport,
} from "./recording.js";

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

export function containRect(source: Pick<Viewport, "width" | "height">, container: Rect): Rect {
  if (source.width <= 0 || source.height <= 0 || container.width <= 0 || container.height <= 0) {
    throw new Error("Source and container dimensions must be positive");
  }
  const scale = Math.min(container.width / source.width, container.height / source.height);
  const width = source.width * scale;
  const height = source.height * scale;
  return {
    x: container.x + (container.width - width) / 2,
    y: container.y + (container.height - height) / 2,
    width,
    height,
  };
}

export function clampPointToRect(point: Point, rect: Rect): Point {
  return {
    x: Math.min(rect.x + rect.width, Math.max(rect.x, point.x)),
    y: Math.min(rect.y + rect.height, Math.max(rect.y, point.y)),
  };
}

export function projectViewportPoint(
  point: Point,
  viewport: Pick<Viewport, "width" | "height">,
  contentRect: Rect,
): Point {
  if (viewport.width <= 0 || viewport.height <= 0) {
    throw new Error("Viewport dimensions must be positive");
  }
  return clampPointToRect(
    {
      x: contentRect.x + (point.x / viewport.width) * contentRect.width,
      y: contentRect.y + (point.y / viewport.height) * contentRect.height,
    },
    contentRect,
  );
}

/* ------------------------------------------------------------------ */
/* Cursor interpolation                                                */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Click clusters                                                      */
/* ------------------------------------------------------------------ */

export type ClusterOptions = {
  clickClusterRadiusPx: number;
  clickClusterWindowMs: number;
};

export type ClickCluster = {
  clicks: ClickEvent[];
  centerX: number;
  centerY: number;
  startMs: number;
  endMs: number;
};

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

function centerOf(clicks: readonly ClickEvent[]): Point {
  return {
    x: clicks.reduce((sum, click) => sum + click.x, 0) / clicks.length,
    y: clicks.reduce((sum, click) => sum + click.y, 0) / clicks.length,
  };
}

function summarize(clicks: ClickEvent[]): ClickCluster {
  const center = centerOf(clicks);
  return {
    clicks,
    centerX: center.x,
    centerY: center.y,
    startMs: clicks[0]?.timestampMs ?? 0,
    endMs: clicks.at(-1)?.timestampMs ?? 0,
  };
}

export function clusterClicks(
  events: readonly RecordingEvent[],
  config: ClusterOptions,
): ClickCluster[] {
  const clicks = events.filter((event): event is ClickEvent => event.type === "click");
  const clusters: ClickEvent[][] = [];

  for (const click of clicks) {
    const current = clusters.at(-1);
    const previous = current?.at(-1);
    const candidate = current ? [...current, click] : [click];
    const candidateCenter = centerOf(candidate);
    const isSpatiallyConsistent = candidate.every(
      (event) => distance(event, candidateCenter) <= config.clickClusterRadiusPx,
    );

    if (
      current &&
      previous &&
      click.timestampMs - previous.timestampMs <= config.clickClusterWindowMs &&
      isSpatiallyConsistent
    ) {
      current.push(click);
    } else {
      clusters.push([click]);
    }
  }

  return clusters.map(summarize);
}

/* ------------------------------------------------------------------ */
/* Zoom windows, camera state, and trim                                */
/* ------------------------------------------------------------------ */

export type ZoomSegment = {
  startMs: number;
  endMs: number;
  focusX: number;
  focusY: number;
  scale: number;
};

export type DemoTimeline = {
  zoomSegments: ZoomSegment[];
  trimStartMs?: number;
  trimEndMs?: number;
};

/** Resolves anchored zooms into absolute windows against real event times. */
export function resolveZoomWindows(zooms: readonly Zoom[], recording: Recording): ZoomSegment[] {
  const segments = zooms.map((zoom) => {
    const firstStep = "step" in zoom ? zoom.step : zoom.fromStep;
    const lastStep = "step" in zoom ? zoom.step : zoom.toStep;
    if (lastStep < firstStep) throw new Error("Zoom toStep must not precede fromStep");

    const leadMs = zoom.leadMs ?? 0;
    const holdMs = zoom.holdMs ?? 0;
    const startMs = stepTimeMs(recording, firstStep) - leadMs;
    const endMs = stepTimeMs(recording, lastStep) + holdMs;
    if (endMs <= startMs) throw new Error("Zoom window is empty after resolving its anchors");

    const point = stepInteractionPoint(recording, firstStep);
    return {
      startMs: Math.max(0, startMs),
      endMs: Math.min(recording.durationMs, endMs),
      focusX: point?.x ?? recording.viewport.width / 2,
      focusY: point?.y ?? recording.viewport.height / 2,
      scale: zoom.scale,
    };
  });

  // oxlint-disable-next-line unicorn/no-array-sort -- ES2022 target lacks Array#toSorted
  const ordered = [...segments].sort((left, right) => left.startMs - right.startMs);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (previous && current && current.startMs < previous.endMs) {
      throw new Error("Presentation zooms must not overlap");
    }
  }
  return segments;
}

export function resolveTrim(
  trim: Trim | undefined,
  recording: Recording,
): { startMs: number; endMs: number } {
  if (!trim) return { startMs: 0, endMs: recording.durationMs };
  const startMs = resolveAnchorMs(trim.from, recording);
  const endMs = resolveAnchorMs(trim.to, recording);
  if (startMs < 0 || endMs > recording.durationMs || endMs <= startMs) {
    throw new Error("Presentation trim range is outside the recording timeline");
  }
  return { startMs, endMs };
}

export function buildTimeline(
  presentation: Presentation | undefined,
  recording: Recording,
): DemoTimeline {
  const zoomSegments = presentation?.zooms ? resolveZoomWindows(presentation.zooms, recording) : [];
  const trim = resolveTrim(presentation?.trim, recording);
  return {
    zoomSegments,
    ...(trim.startMs === 0 ? {} : { trimStartMs: trim.startMs }),
    ...(trim.endMs === recording.durationMs ? {} : { trimEndMs: trim.endMs }),
  };
}

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
    return { scale: 1, originX: neutralOrigin.x, originY: neutralOrigin.y };
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

/* ------------------------------------------------------------------ */
/* Renderer input                                                      */
/* ------------------------------------------------------------------ */

export type ProductDemoInput = {
  recording: Recording;
  videoUrl: string;
  timeline: DemoTimeline;
  config: RenderConfig;
};
