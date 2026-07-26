import type { ProductDemoRenderInput } from "../types.js";
import { buildCameraExpressions } from "./camera-expression.js";
import { productDemoGeometry } from "./geometry.js";

export type ProductDemoFilterGraph = {
  script: string;
  frameCount: number;
  durationMs: number;
};

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
  const script = [
    `[0:v]trim=start=${trimStartMs / 1000}:end=${trimEndMs / 1000},setpts=PTS-STARTPTS,fps=${config.fps},scale=${content.width}:${content.height}:flags=lanczos,format=rgba[source]`,
    `[2:v]format=rgba,alphaextract[content_mask]`,
    `[source][content_mask]alphamerge[content]`,
    `color=c=black@0.0:s=${output}:r=${config.fps},format=rgba[transparent]`,
    `[transparent][1:v]overlay=x=0:y=0:eof_action=repeat:repeatlast=1:format=auto[underlay]`,
    `[underlay][content]overlay=x=${content.x}:y=${content.y}:eof_action=repeat:repeatlast=1:format=auto[video]`,
    `[video][3:v]overlay=x=0:y=0:eof_action=repeat:repeatlast=1:format=auto[shell]`,
    `[shell]ass=filename=timed-overlays.subtitle:alpha=1,format=rgba[decorated]`,
    `[decorated]scale=w='${camera.scaledWidth}':h='${camera.scaledHeight}':eval=frame:flags=bicubic,setsar=1[camera]`,
    `color=c=black:s=${output}:r=${config.fps},format=rgba[background_canvas]`,
    `[background_canvas][4:v]overlay=x=0:y=0:eof_action=repeat:repeatlast=1:format=auto[background]`,
    `[background][camera]overlay=x='${camera.overlayX}':y='${camera.overlayY}':eval=frame:eof_action=repeat:repeatlast=1:format=auto,fps=${config.fps},trim=end_frame=${frameCount},setpts=N/(${config.fps}*TB),colorspace=iall=bt709:all=bt709:format=yuv420p[output]`,
  ].join(";\n");
  return { script, frameCount, durationMs };
}
