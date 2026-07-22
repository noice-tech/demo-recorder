import {
  cameraStateAt,
  containRect,
  cursorPositionAt,
  projectViewportPoint,
  type ClickEvent,
  type ProductDemoInput,
} from "@noice-tech/demo-recorder-core/browser";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { BrowserFrame, BROWSER_TITLE_BAR_HEIGHT } from "../../components/BrowserFrame.js";
import { ClickIndicator } from "../../components/ClickIndicator.js";
import { Cursor } from "../../components/Cursor.js";
import { VideoLayer } from "../../components/VideoLayer.js";

const FRAME_PADDING_X_RATIO = 0.065;
const FRAME_PADDING_Y_RATIO = 0.09;

const latestClickAt = (
  clicks: readonly ClickEvent[],
  timestampMs: number,
): ClickEvent | undefined => {
  for (let index = clicks.length - 1; index >= 0; index -= 1) {
    const click = clicks[index];
    if (click && click.timestampMs <= timestampMs) return click;
  }
  return undefined;
};

export function ProductDemo(input: ProductDemoInput) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const trimStartMs = input.timeline.trimStartMs ?? 0;
  const trimEndMs = input.timeline.trimEndMs ?? input.recording.durationMs;
  const timestampMs = trimStartMs + (frame / fps) * 1000;
  const paddingX = width * FRAME_PADDING_X_RATIO;
  const paddingY = height * FRAME_PADDING_Y_RATIO;
  const contentRect = containRect(input.recording.viewport, {
    x: paddingX,
    y: paddingY + BROWSER_TITLE_BAR_HEIGHT,
    width: width - paddingX * 2,
    height: height - paddingY * 2 - BROWSER_TITLE_BAR_HEIGHT,
  });
  const browserRect = {
    x: contentRect.x,
    y: contentRect.y - BROWSER_TITLE_BAR_HEIGHT,
    width: contentRect.width,
    height: contentRect.height + BROWSER_TITLE_BAR_HEIGHT,
  };
  const localContentRect = { x: 0, y: 0, width: contentRect.width, height: contentRect.height };
  const camera = cameraStateAt({
    timestampMs,
    segments: input.timeline.zoomSegments,
    viewport: input.recording.viewport,
    contentRect,
    enterDurationMs: input.config.zoom.enterDurationMs,
    exitDurationMs: input.config.zoom.exitDurationMs,
  });
  const cursorSource = cursorPositionAt(input.recording.events, timestampMs) ?? {
    x: input.recording.viewport.width / 2,
    y: input.recording.viewport.height / 2,
  };
  const cursorPosition = projectViewportPoint(
    cursorSource,
    input.recording.viewport,
    localContentRect,
  );
  const clicks = input.recording.events.filter(
    (event): event is ClickEvent => event.type === "click",
  );
  const latestClick = latestClickAt(clicks, timestampMs);
  const clickPosition = latestClick
    ? projectViewportPoint(latestClick, input.recording.viewport, localContentRect)
    : undefined;
  const clickAgeMs = latestClick ? timestampMs - latestClick.timestampMs : Number.POSITIVE_INFINITY;
  let title = "Product demo";
  for (const event of input.recording.events) {
    if (event.timestampMs > timestampMs) break;
    if (event.type === "navigation") title = event.url;
  }

  return (
    <AbsoluteFill
      style={{
        overflow: "hidden",
        background:
          "radial-gradient(circle at 20% 15%, #31456e 0%, transparent 38%), radial-gradient(circle at 80% 85%, #1f604e 0%, transparent 36%), linear-gradient(145deg, #111522 0%, #080a10 100%)",
      }}
    >
      <AbsoluteFill
        style={{
          transform: `scale(${camera.scale})`,
          transformOrigin: `${camera.originX}px ${camera.originY}px`,
        }}
      >
        <BrowserFrame rect={browserRect} title={title}>
          <VideoLayer
            src={input.videoUrl}
            width={contentRect.width}
            height={contentRect.height}
            trimBefore={Math.floor((trimStartMs / 1000) * fps)}
            trimAfter={Math.ceil((trimEndMs / 1000) * fps)}
          />
          {clickPosition ? <ClickIndicator position={clickPosition} ageMs={clickAgeMs} /> : null}
          {input.config.cursorEnabled ? (
            <Cursor position={cursorPosition} pressed={clickAgeMs >= 0 && clickAgeMs <= 140} />
          ) : null}
        </BrowserFrame>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
