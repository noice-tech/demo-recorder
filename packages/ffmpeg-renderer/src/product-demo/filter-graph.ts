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
  const browser = geometry.browser;
  const shadowX = Math.round((browser.width * 90) / 1340);
  const shadowY = Math.round((browser.height * 90) / 886);
  const script = [
    `[0:v]trim=start=${trimStartMs / 1000}:end=${trimEndMs / 1000},setpts=PTS-STARTPTS,fps=${config.fps},scale=${content.width}:${content.height}:flags=lanczos,format=rgba[source]`,
    `[1:v]crop=1520:1066:200:7,scale=${browser.width + shadowX * 2}:${browser.height + shadowY * 2}:flags=lanczos,format=rgba[browser_underlay]`,
    `[2:v]scale=${content.width}:${content.height}:flags=lanczos,format=rgba,alphaextract[content_mask]`,
    `[3:v]split=2[overlay_title_source][overlay_border_source]`,
    `[overlay_title_source]crop=1340:48:290:97,scale=${browser.width}:48:flags=lanczos,format=rgba[browser_title]`,
    `[overlay_border_source]crop=1340:838:290:145,scale=${content.width}:${content.height}:flags=lanczos,format=rgba[browser_border]`,
    `[4:v]scale=${config.width}:${config.height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${config.width}:${config.height},format=rgba[background_asset]`,
    `[source][content_mask]alphamerge[content]`,
    `color=c=black@0.0:s=${output}:r=${config.fps},format=rgba[transparent]`,
    `[transparent][browser_underlay]overlay=x=${browser.x - shadowX}:y=${browser.y - shadowY}:eof_action=repeat:repeatlast=1:format=auto[underlay]`,
    `[underlay][content]overlay=x=${content.x}:y=${content.y}:eof_action=repeat:repeatlast=1:format=auto[video]`,
    `[video][browser_title]overlay=x=${browser.x}:y=${browser.y}:eof_action=repeat:repeatlast=1:format=auto[titled]`,
    `[titled][browser_border]overlay=x=${content.x}:y=${content.y}:eof_action=repeat:repeatlast=1:format=auto[shell]`,
    `[shell]ass=filename=timed-overlays.subtitle:fontsdir=fonts:alpha=1,format=rgba[decorated]`,
    `[decorated]scale=w='${camera.scaledWidth}':h='${camera.scaledHeight}':eval=frame:flags=bicubic,setsar=1[camera]`,
    `color=c=black:s=${output}:r=${config.fps},format=rgba[background_canvas]`,
    `[background_canvas][background_asset]overlay=x=0:y=0:eof_action=repeat:repeatlast=1:format=auto[background]`,
    `[background][camera]overlay=x='${camera.overlayX}':y='${camera.overlayY}':eval=frame:eof_action=repeat:repeatlast=1:format=auto,fps=${config.fps},trim=end_frame=${frameCount},setpts=N/(${config.fps}*TB),colorspace=iall=bt709:all=bt709:format=yuv420p[output]`,
  ].join(";\n");
  return { script, frameCount, durationMs };
}
