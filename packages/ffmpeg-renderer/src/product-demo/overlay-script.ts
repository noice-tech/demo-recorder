import {
  cursorPositionAt,
  projectViewportPoint,
  type ClickEvent,
  type ProductDemoInput,
} from "@noice-tech/demo-recorder-core";
import {
  browserFrameAddressColor,
  computeBrowserFrameLayout,
  drawBrowserFrame,
  formatBrowserAddress,
} from "./browser-frame.js";
import type { ProductDemoGeometry } from "./geometry.js";

function subtitleTime(seconds: number): string {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(centiseconds / 360_000);
  const minutes = Math.floor((centiseconds % 360_000) / 6_000);
  const remainingSeconds = Math.floor((centiseconds % 6_000) / 100);
  const fraction = centiseconds % 100;
  return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds
    .toString()
    .padStart(2, "0")}.${fraction.toString().padStart(2, "0")}`;
}

function number(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function alpha(opacity: number): string {
  const value = Math.round(255 * (1 - Math.min(1, Math.max(0, opacity))));
  return value.toString(16).padStart(2, "0").toUpperCase();
}

function safeText(value: string): string {
  return value
    .replaceAll("\\", "＼")
    .replaceAll("{", "｛")
    .replaceAll("}", "｝")
    .replaceAll(/\r?\n/g, " ");
}

function dialogue(
  layer: number,
  startSeconds: number,
  endSeconds: number,
  style: string,
  text: string,
): string {
  return `Dialogue: ${layer},${subtitleTime(startSeconds)},${subtitleTime(endSeconds)},${style},,0,0,0,,${text}`;
}

function latestClickAt(clicks: readonly ClickEvent[], timestampMs: number): ClickEvent | undefined {
  for (let index = clicks.length - 1; index >= 0; index -= 1) {
    const click = clicks[index];
    if (click && click.timestampMs <= timestampMs) return click;
  }
  return undefined;
}

const cursorPath = "m 2 2 l 2 26 l 8 21 l 12 32 l 16 30 l 12 19 l 22 19 l 2 2";

function circlePath(radius: number): string {
  const diameter = radius * 2;
  const control = radius * 0.55228475;
  return [
    `m ${number(radius)} 0`,
    `b ${number(radius + control)} 0 ${number(diameter)} ${number(radius - control)} ${number(diameter)} ${number(radius)}`,
    `b ${number(diameter)} ${number(radius + control)} ${number(radius + control)} ${number(diameter)} ${number(radius)} ${number(diameter)}`,
    `b ${number(radius - control)} ${number(diameter)} 0 ${number(radius + control)} 0 ${number(radius)}`,
    `b 0 ${number(radius - control)} ${number(radius - control)} 0 ${number(radius)} 0`,
  ].join(" ");
}

export function generateTimedOverlayScript(input: {
  composition: Omit<ProductDemoInput, "videoUrl">;
  geometry: ProductDemoGeometry;
  frameCount: number;
}): string {
  const { recording, timeline, config } = input.composition;
  const fps = config.fps;
  const trimStartMs = timeline.trimStartMs ?? 0;
  const trimEndMs = timeline.trimEndMs ?? recording.durationMs;
  const durationSeconds = input.frameCount / fps;
  const content = input.geometry.content;
  const browser = input.geometry.browser;
  const clip = `\\clip(${content.x},${content.y},${content.x + content.width},${content.y + content.height})`;
  const events: string[] = [];

  const browserFrame = computeBrowserFrameLayout(browser);
  for (const drawing of drawBrowserFrame(browserFrame, config.browserFrameTheme)) {
    events.push(dialogue(drawing.layer, 0, durationSeconds, "Drawing", drawing.text));
  }

  let title = "Product demo";
  let titleStartMs = trimStartMs;
  const titleEvents: Array<{ startMs: number; endMs: number; text: string }> = [];
  for (const event of recording.events) {
    if (event.type !== "navigation") continue;
    if (event.timestampMs <= trimStartMs) {
      title = event.url;
      continue;
    }
    if (event.timestampMs >= trimEndMs) break;
    titleEvents.push({ startMs: titleStartMs, endMs: event.timestampMs, text: title });
    title = event.url;
    titleStartMs = event.timestampMs;
  }
  titleEvents.push({ startMs: titleStartMs, endMs: trimEndMs, text: title });
  const address = browserFrame.address;
  const addressText = browserFrame.addressText;
  const addressCenterX = address.x + address.width / 2;
  const includeAddressPath = address.width >= 320;
  for (const interval of titleEvents) {
    const start = Math.max(0, (interval.startMs - trimStartMs) / 1000);
    const end = Math.min(durationSeconds, (interval.endMs - trimStartMs) / 1000);
    if (end <= start) continue;
    const displayAddress = formatBrowserAddress(interval.text, includeAddressPath);
    events.push(
      dialogue(
        30,
        start,
        end,
        "BrowserAddress",
        `{\\an5\\pos(${number(addressCenterX)},${number(address.y + address.height / 2)})\\clip(${number(addressText.x)},${number(addressText.y)},${number(addressText.x + addressText.width)},${number(addressText.y + addressText.height)})\\1c&${browserFrameAddressColor(config.browserFrameTheme)}&\\q2}${safeText(displayAddress)}`,
      ),
    );
  }

  const clicks = recording.events.filter((event): event is ClickEvent => event.type === "click");
  for (let frame = 0; frame < input.frameCount; frame += 1) {
    const start = frame / fps;
    const end = (frame + 1) / fps;
    const timestampMs = trimStartMs + start * 1000;
    const latestClick = latestClickAt(clicks, timestampMs);
    const clickAgeMs = latestClick
      ? timestampMs - latestClick.timestampMs
      : Number.POSITIVE_INFINITY;

    if (latestClick && clickAgeMs >= 0 && clickAgeMs <= 520) {
      const position = projectViewportPoint(latestClick, recording.viewport, content);
      const progress = clickAgeMs / 520;
      const eased = 1 - (1 - progress) * (1 - progress);
      const size = 18 + eased * 92;
      const radius = size / 2;
      const opacity = 0.72 * (1 - progress);
      const path = circlePath(radius);
      const positionTag = `\\an7\\pos(${number(position.x - radius)},${number(position.y - radius)})`;
      events.push(
        dialogue(
          10,
          start,
          end,
          "Drawing",
          `{${clip}${positionTag}\\p1\\bord6\\blur8\\1a&HFF&\\3a&H${alpha(0.2 * (1 - progress))}&\\3c&H00CDF08C&}${path}`,
        ),
        dialogue(
          11,
          start,
          end,
          "Drawing",
          `{${clip}${positionTag}\\p1\\bord${number(Math.max(2, 4 - progress * 2))}\\1a&HFF&\\3a&H${alpha(opacity)}&\\3c&H00CDF08C&}${path}`,
        ),
      );
    }

    if (config.cursorEnabled) {
      const source = cursorPositionAt(recording.events, timestampMs) ?? {
        x: recording.viewport.width / 2,
        y: recording.viewport.height / 2,
      };
      const position = projectViewportPoint(source, recording.viewport, content);
      const pressed = clickAgeMs >= 0 && clickAgeMs <= 140;
      const scale = pressed ? 84 : 100;
      const adjustment = pressed ? 4 * (1 - 0.84) : 0;
      const x = position.x - 2 + adjustment;
      const y = position.y - 2 + adjustment;
      events.push(
        dialogue(
          20,
          start,
          end,
          "Drawing",
          `{${clip}\\an7\\pos(${number(x)},${number(y + 5)})\\fscx${scale}\\fscy${scale}\\p1\\bord0\\blur4\\1c&H000000&\\1a&H60&}${cursorPath}`,
        ),
        dialogue(
          21,
          start,
          end,
          "Drawing",
          `{${clip}\\an7\\pos(${number(x)},${number(y)})\\fscx${scale}\\fscy${scale}\\p1\\bord1.8\\1c&H100B08&\\3c&HFFFFFF&}${cursorPath}`,
        ),
      );
    }
  }

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${config.width}`,
    `PlayResY: ${config.height}`,
    "ScaledBorderAndShadow: yes",
    "WrapStyle: 2",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: BrowserAddress,Inter,14,&H002F2F2F,&H002F2F2F,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1",
    "Style: Drawing,Inter,16,&H00000000,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}
