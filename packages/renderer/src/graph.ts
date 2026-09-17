import {
  projectViewportPoint,
  type DemoTimeline,
  type Viewport,
} from "@noice-tech/demo-recorder-core";
import type { ProductDemoRenderInput } from "./ffmpeg.js";
import { browserCornerRadius, productDemoGeometry, type ProductDemoGeometry } from "./frames.js";

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

export type ProductDemoFilterGraph = {
  script: string;
  frameCount: number;
  durationMs: number;
};

// Signed-distance coverage gives every raster layer the same antialiased corners.
// These filters run on single-frame assets, not on every frame of the recording.
function roundedAlpha(width: number, height: number, radius: number, x: number, y: number): string {
  const dx = `abs(X+0.5-${number(x + width / 2)})-${number(width / 2 - radius)}`;
  const dy = `abs(Y+0.5-${number(y + height / 2)})-${number(height / 2 - radius)}`;
  return `255*clip(0.5-(hypot(max(${dx},0),max(${dy},0))+min(max(${dx},${dy}),0)-${radius}),0,1)`;
}

export function buildProductDemoFilterGraph(input: ProductDemoRenderInput): ProductDemoFilterGraph {
  const { config, recording, timeline } = input;
  const trimStartMs = timeline.trimStartMs ?? 0;
  const trimEndMs = timeline.trimEndMs ?? recording.durationMs;
  if (trimStartMs < 0 || trimEndMs <= trimStartMs || trimEndMs > recording.durationMs) {
    throw new Error("Render trim range must be ordered and inside the recording duration");
  }
  const durationMs = trimEndMs - trimStartMs;
  const frameCount = Math.max(1, Math.ceil((durationMs / 1000) * config.fps));
  const geometry = productDemoGeometry(recording.viewport, config);
  const camera = buildCameraExpressions({
    timeline,
    viewport: recording.viewport,
    geometry,
    output: config,
    enterDurationMs: config.zoom.enterDurationMs,
    exitDurationMs: config.zoom.exitDurationMs,
  });
  const content = geometry.content;
  const output = `${config.width}x${config.height}`;
  const browser = geometry.browser;
  const shadowX = Math.round((browser.width * 90) / 1340);
  const shadowY = Math.round((browser.height * 90) / 886);
  const radius = browserCornerRadius(browser);
  const shadowAlpha = roundedAlpha(browser.width, browser.height, radius, shadowX, shadowY + 10);
  const contentAlpha = roundedAlpha(
    browser.width,
    browser.height,
    radius,
    0,
    browser.y - content.y,
  );
  const script = [
    `[0:v]trim=start=${trimStartMs / 1000}:end=${trimEndMs / 1000},setpts=PTS-STARTPTS,fps=${config.fps},scale=${content.width}:${content.height}:flags=lanczos,format=rgba[source]`,
    `[1:v]scale=${browser.width + shadowX * 2}:${browser.height + shadowY * 2},format=rgba,geq=r=0:g=0:b=0:a='0.28*(${shadowAlpha})',gblur=sigma=18:planes=8,format=rgba[browser_underlay]`,
    `[2:v]scale=${content.width}:${content.height},format=rgba,geq=r=255:g=255:b=255:a='${contentAlpha}',format=rgba,alphaextract[content_mask]`,
    `[4:v]scale=${config.width}:${config.height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${config.width}:${config.height},format=rgba[background_asset]`,
    `[source][content_mask]alphamerge[content]`,
    `color=c=black@0.0:s=${output}:r=${config.fps},format=rgba[transparent]`,
    `[transparent][browser_underlay]overlay=x=${browser.x - shadowX}:y=${browser.y - shadowY}:eof_action=repeat:repeatlast=1:format=auto[underlay]`,
    `[underlay][content]overlay=x=${content.x}:y=${content.y}:eof_action=repeat:repeatlast=1:format=auto[video]`,
    `[video]ass=filename=timed-overlays.subtitle:fontsdir=fonts:alpha=1,format=rgba[decorated]`,
    `[decorated]scale=w='${camera.scaledWidth}':h='${camera.scaledHeight}':eval=frame:flags=bicubic,setsar=1[camera]`,
    `color=c=black:s=${output}:r=${config.fps},format=rgba[background_canvas]`,
    `[background_canvas][background_asset]overlay=x=0:y=0:eof_action=repeat:repeatlast=1:format=auto[background]`,
    `[background][camera]overlay=x='${camera.overlayX}':y='${camera.overlayY}':eval=frame:eof_action=repeat:repeatlast=1:format=auto,fps=${config.fps},trim=end_frame=${frameCount},setpts=N/(${config.fps}*TB),format=rgba[composed]`,
    `[composed]ass=filename=keyboard-overlays.subtitle:fontsdir=fonts:alpha=1,colorspace=iall=bt709:all=bt709:format=yuv420p[output]`,
  ].join(";\n");
  return { script, frameCount, durationMs };
}
