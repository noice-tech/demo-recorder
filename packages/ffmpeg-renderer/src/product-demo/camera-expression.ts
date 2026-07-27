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

function smoothStep(progress: string): string {
  return `(pow(${progress},2)*(3-2*${progress}))`;
}

function segmentScale(
  time: string,
  segment: DemoTimeline["zoomSegments"][number],
  enterDurationMs: number,
  exitDurationMs: number,
): string {
  const durationMs = Math.max(0, segment.endMs - segment.startMs);
  const { enterMs, exitMs } = transitionDurations(durationMs, enterDurationMs, exitDurationMs);
  const target = number(segment.scale);
  let hold = target;
  if (exitMs > 0) {
    const exitStart = segment.endMs - exitMs;
    const progress = `((${time}-${number(exitStart / 1000)})/${number(exitMs / 1000)})`;
    hold = `if(gt(${time},${number(exitStart / 1000)}),${target}-(${target}-1)*${smoothStep(progress)},${hold})`;
  }
  if (enterMs > 0) {
    const enterEnd = segment.startMs + enterMs;
    const progress = `((${time}-${number(segment.startMs / 1000)})/${number(enterMs / 1000)})`;
    hold = `if(lt(${time},${number(enterEnd / 1000)}),1+(${target}-1)*${smoothStep(progress)},${hold})`;
  }
  return hold;
}

function piecewise(
  time: string,
  segments: DemoTimeline["zoomSegments"],
  value: (segment: DemoTimeline["zoomSegments"][number]) => string,
  fallback: string,
): string {
  let expression = fallback;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (!segment) continue;
    expression = `if(between(${time},${number(segment.startMs / 1000)},${number(segment.endMs / 1000)}),${value(segment)},${expression})`;
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
    (segment) => segmentScale(time, segment, input.enterDurationMs, input.exitDurationMs),
    "1",
  );
  const neutralX = input.geometry.content.x + input.geometry.content.width / 2;
  const neutralY = input.geometry.content.y + input.geometry.content.height / 2;
  const originX = piecewise(
    time,
    input.timeline.zoomSegments,
    (segment) =>
      number(
        projectViewportPoint(
          { x: segment.focusX, y: segment.focusY },
          input.viewport,
          input.geometry.content,
        ).x,
      ),
    number(neutralX),
  );
  const originY = piecewise(
    time,
    input.timeline.zoomSegments,
    (segment) =>
      number(
        projectViewportPoint(
          { x: segment.focusX, y: segment.focusY },
          input.viewport,
          input.geometry.content,
        ).y,
      ),
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
