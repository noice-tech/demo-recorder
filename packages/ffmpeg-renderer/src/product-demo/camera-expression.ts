import {
  projectViewportPoint,
  type DemoTimeline,
  type Viewport,
} from "@noice-tech/demo-recorder-core";
import type { ProductDemoGeometry } from "./geometry.js";

export type CameraExpressions = {
  scale: string;
  originX: string;
  originY: string;
  scaledWidth: string;
  scaledHeight: string;
  overlayX: string;
  overlayY: string;
};

function number(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function transitionDurations(
  durationMs: number,
  enterDurationMs: number,
  exitDurationMs: number,
): { enterMs: number; exitMs: number } {
  const enter = Math.max(0, enterDurationMs);
  const exit = Math.max(0, exitDurationMs);
  const total = enter + exit;
  if (total === 0 || total <= durationMs) return { enterMs: enter, exitMs: exit };
  const ratio = durationMs / total;
  return { enterMs: enter * ratio, exitMs: exit * ratio };
}

const SPRING_RESPONSE = 6;
const SPRING_NORMALIZATION = 1 - (1 + SPRING_RESPONSE) * Math.exp(-SPRING_RESPONSE);

function springStep(progress: string): string {
  return `((1-(1+${SPRING_RESPONSE}*${progress})*exp(-${SPRING_RESPONSE}*${progress}))/${number(SPRING_NORMALIZATION)})`;
}

const joined = (
  left: DemoTimeline["zoomSegments"][number] | undefined,
  right: DemoTimeline["zoomSegments"][number] | undefined,
): boolean => Boolean(left && right && Math.abs(left.endMs - right.startMs) < 0.001);

function segmentScale(
  time: string,
  segments: DemoTimeline["zoomSegments"],
  index: number,
  enterDurationMs: number,
  exitDurationMs: number,
): string {
  const segment = segments[index]!;
  const previous = segments[index - 1];
  const next = segments[index + 1];
  const durationMs = Math.max(0, segment.endMs - segment.startMs);
  const { enterMs, exitMs } = transitionDurations(durationMs, enterDurationMs, exitDurationMs);
  const target = number(segment.scale);
  let hold = target;
  if (!joined(segment, next) && exitMs > 0) {
    const exitStart = segment.endMs - exitMs;
    const progress = `((${time}-${number(exitStart / 1000)})/${number(exitMs / 1000)})`;
    hold = `if(gt(${time},${number(exitStart / 1000)}),${target}-(${target}-1)*${springStep(progress)},${hold})`;
  }
  if (enterMs > 0) {
    const enterEnd = segment.startMs + enterMs;
    const progress = `((${time}-${number(segment.startMs / 1000)})/${number(enterMs / 1000)})`;
    const initial = joined(previous, segment) ? number(previous!.scale) : "1";
    hold = `if(lt(${time},${number(enterEnd / 1000)}),${initial}+(${target}-${initial})*${springStep(progress)},${hold})`;
  }
  return hold;
}

function piecewise(
  time: string,
  segments: DemoTimeline["zoomSegments"],
  value: (segment: DemoTimeline["zoomSegments"][number], index: number) => string,
  fallback: string,
): string {
  let expression = fallback;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (!segment) continue;
    expression = `if(between(${time},${number(segment.startMs / 1000)},${number(segment.endMs / 1000)}),${value(segment, index)},${expression})`;
  }
  return expression;
}

export function buildCameraExpressions(input: {
  timeline: DemoTimeline;
  viewport: Pick<Viewport, "width" | "height">;
  geometry: ProductDemoGeometry;
  output: { width: number; height: number };
  enterDurationMs: number;
  exitDurationMs: number;
}): CameraExpressions {
  const trimStartMs = input.timeline.trimStartMs ?? 0;
  const time = trimStartMs === 0 ? "t" : `(t+${number(trimStartMs / 1000)})`;
  const scale = piecewise(
    time,
    input.timeline.zoomSegments,
    (_segment, index) =>
      segmentScale(
        time,
        input.timeline.zoomSegments,
        index,
        input.enterDurationMs,
        input.exitDurationMs,
      ),
    "1",
  );
  const neutralX = input.geometry.content.x + input.geometry.content.width / 2;
  const neutralY = input.geometry.content.y + input.geometry.content.height / 2;
  const segmentOrigin = (index: number, axis: "x" | "y"): string => {
    const segment = input.timeline.zoomSegments[index]!;
    const target = projectViewportPoint(
      { x: segment.focusX, y: segment.focusY },
      input.viewport,
      input.geometry.content,
    )[axis];
    const previous = input.timeline.zoomSegments[index - 1];
    if (!joined(previous, segment) || input.enterDurationMs === 0) return number(target);

    const enterMs = transitionDurations(
      segment.endMs - segment.startMs,
      input.enterDurationMs,
      input.exitDurationMs,
    ).enterMs;
    if (enterMs === 0) return number(target);
    const source = projectViewportPoint(
      { x: previous!.focusX, y: previous!.focusY },
      input.viewport,
      input.geometry.content,
    )[axis];
    const enterEnd = segment.startMs + enterMs;
    const progress = `((${time}-${number(segment.startMs / 1000)})/${number(enterMs / 1000)})`;
    return `if(lt(${time},${number(enterEnd / 1000)}),${number(source)}+(${number(target)}-${number(source)})*${springStep(progress)},${number(target)})`;
  };
  const originX = piecewise(
    time,
    input.timeline.zoomSegments,
    (_segment, index) => segmentOrigin(index, "x"),
    number(neutralX),
  );
  const originY = piecewise(
    time,
    input.timeline.zoomSegments,
    (_segment, index) => segmentOrigin(index, "y"),
    number(neutralY),
  );
  const scaledWidth = `trunc(${input.output.width}*(${scale})/2)*2`;
  const scaledHeight = `trunc(${input.output.height}*(${scale})/2)*2`;
  return {
    scale,
    originX,
    originY,
    scaledWidth,
    scaledHeight,
    overlayX: `(${originX})*(1-overlay_w/${input.output.width})`,
    overlayY: `(${originY})*(1-overlay_h/${input.output.height})`,
  };
}
