import {
  cursorPositionAt,
  projectViewportPoint,
  type ClickEvent,
  type KeyPressEvent,
  type ProductDemoInput,
} from "@noice-tech/demo-recorder-core";
import {
  browserFrameAddressColor,
  computeBrowserFrameLayout,
  drawBrowserFrame,
  formatBrowserAddress,
  type ProductDemoGeometry,
} from "./frames.js";

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

// The tip is the origin so click feedback never shifts the pointer hotspot.
const cursorPath = "m 0 0 l 0 21 l 5.5 16.5 l 9.5 26 l 13 24.5 l 9 15 l 17 15 l 0 0";

function circlePath(radius: number): string {
  const diameter = radius * 2;
  const control = radius * 0.55228475;
  return [
    `m ${number(radius)} 0`,
    `b ${number(radius + control)} 0 ${number(diameter)} ${number(radius - control)} ${number(diameter)} ${number(radius)}`,
    `b ${number(diameter)} ${number(radius + control)} ${number(radius + control)} ${number(diameter)} ${number(radius)} ${number(diameter)}`,
    `b ${number(radius - control)} ${number(diameter)} 0 ${number(radius + control)} 0 ${number(radius)} ${number(diameter)}`,
    `b 0 ${number(radius - control)} ${number(radius - control)} 0 ${number(radius)} 0`,
  ].join(" ");
}

function roundedRectanglePath(width: number, height: number, radius: number): string {
  const control = radius * 0.55228475;
  return [
    `m ${number(radius)} 0`,
    `l ${number(width - radius)} 0`,
    `b ${number(width - radius + control)} 0 ${number(width)} ${number(radius - control)} ${number(width)} ${number(radius)}`,
    `l ${number(width)} ${number(height - radius)}`,
    `b ${number(width)} ${number(height - radius + control)} ${number(width - radius + control)} ${number(height)} ${number(width - radius)} ${number(height)}`,
    `l ${number(radius)} ${number(height)}`,
    `b ${number(radius - control)} ${number(height)} 0 ${number(height - radius + control)} 0 ${number(height - radius)}`,
    `l 0 ${number(radius)}`,
    `b 0 ${number(radius - control)} ${number(radius - control)} 0 ${number(radius)} 0`,
  ].join(" ");
}

const keyboardOverlayDurationMs = 1_100;

export function keyDisplayLabel(key: string): string {
  const labels: Record<string, string> = {
    Meta: "⌘",
    Control: "ctrl",
    Alt: "⌥",
    Shift: "⇧",
    Escape: "esc",
    Enter: "↵",
    Backspace: "⌫",
    Delete: "del",
    Space: "space",
    Tab: "tab",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    PageUp: "pg up",
    PageDown: "pg dn",
  };
  return labels[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

export function keyOverlayIntervals(
  events: readonly KeyPressEvent[],
  trimStartMs: number,
  trimEndMs: number,
): Array<{ event: KeyPressEvent; startMs: number; endMs: number }> {
  return events.flatMap((event, index) => {
    const next = events[index + 1];
    const startMs = Math.max(trimStartMs, event.timestampMs);
    const endMs = Math.min(
      trimEndMs,
      event.timestampMs + keyboardOverlayDurationMs,
      next?.timestampMs ?? trimEndMs,
    );
    return endMs > startMs ? [{ event, startMs, endMs }] : [];
  });
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
  for (const interval of titleEvents) {
    const start = Math.max(0, (interval.startMs - trimStartMs) / 1000);
    const end = Math.min(durationSeconds, (interval.endMs - trimStartMs) / 1000);
    if (end <= start) continue;
    const displayAddress = formatBrowserAddress(interval.text, false);
    events.push(
      dialogue(
        30,
        start,
        end,
        "BrowserAddress",
        `{\\an5\\pos(${number(addressCenterX)},${number(address.y + address.height / 2)})\\clip(${number(addressText.x)},${number(addressText.y)},${number(addressText.x + addressText.width)},${number(addressText.y + addressText.height)})\\b0\\bord0\\1c&${browserFrameAddressColor(config.browserFrameTheme)}&\\q2}${safeText(displayAddress)}`,
      ),
    );
  }

  const clicks: ClickEvent[] = [];
  for (const event of recording.events) if (event.type === "click") clicks.push(event);
  for (let frame = 0; frame < input.frameCount; frame += 1) {
    const start = frame / fps;
    const end = (frame + 1) / fps;
    const timestampMs = trimStartMs + start * 1000;
    const latestClick = latestClickAt(clicks, timestampMs);
    const clickAgeMs = latestClick
      ? timestampMs - latestClick.timestampMs
      : Number.POSITIVE_INFINITY;

    if (latestClick && clickAgeMs >= 0 && clickAgeMs < 240) {
      const position = projectViewportPoint(latestClick, recording.viewport, content);
      const progress = clickAgeMs / 240;
      const eased = 1 - (1 - progress) * (1 - progress);
      const size = 18 + eased * 18;
      const radius = size / 2;
      const opacity = 0.5 * (1 - progress);
      const path = circlePath(radius);
      const positionTag = `\\an7\\pos(${number(position.x - radius)},${number(position.y - radius)})`;
      events.push(
        dialogue(
          10,
          start,
          end,
          "Drawing",
          `{${clip}${positionTag}\\p1\\bord2.25\\1a&HFF&\\3a&H${alpha(opacity * 0.65)}&\\3c&HF5F5F5&}${path}`,
        ),
        dialogue(
          11,
          start,
          end,
          "Drawing",
          `{${clip}${positionTag}\\p1\\bord1\\1a&HFF&\\3a&H${alpha(opacity)}&\\3c&H737373&}${path}`,
        ),
      );
    }

    if (config.cursorEnabled) {
      const source = cursorPositionAt(recording.events, timestampMs) ?? {
        x: recording.viewport.width / 2,
        y: recording.viewport.height / 2,
      };
      const position = projectViewportPoint(source, recording.viewport, content);
      const { x, y } = position;
      events.push(
        dialogue(
          20,
          start,
          end,
          "Drawing",
          `{${clip}\\an7\\pos(${number(x)},${number(y + 1)})\\p1\\bord0\\blur1\\1c&H000000&\\1a&HB3&}${cursorPath}`,
        ),
        dialogue(
          21,
          start,
          end,
          "Drawing",
          `{${clip}\\an7\\pos(${number(x)},${number(y)})\\p1\\bord1\\1c&H181818&\\3c&HF5F5F5&}${cursorPath}`,
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
    "Style: BrowserAddress,Inter Medium,14,&H002F2F2F,&H002F2F2F,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1",
    "Style: Drawing,Inter,16,&H00000000,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}

/** Generates a Screen Studio-style keyboard HUD in final-canvas coordinates. */
export function generateKeyboardOverlayScript(input: {
  composition: Omit<ProductDemoInput, "videoUrl">;
  frameCount: number;
}): string {
  const { recording, timeline, config } = input.composition;
  const trimStartMs = timeline.trimStartMs ?? 0;
  const trimEndMs = timeline.trimEndMs ?? recording.durationMs;
  const durationSeconds = input.frameCount / config.fps;
  const keyEvents: KeyPressEvent[] = [];
  for (const event of recording.events) if (event.type === "key-press") keyEvents.push(event);
  const events: string[] = [];

  for (const interval of keyOverlayIntervals(keyEvents, trimStartMs, trimEndMs)) {
    const labels = interval.event.keys.map(keyDisplayLabel);
    const keyWidths = labels.map((label) => Math.max(50, 28 + [...label].length * 17));
    const separatorWidth = 28;
    const innerGap = 8;
    const outerPadding = 12;
    const keyHeight = 52;
    const outerHeight = keyHeight + outerPadding * 2;
    const outerWidth =
      keyWidths.reduce((sum, width) => sum + width, 0) +
      Math.max(0, labels.length - 1) * (separatorWidth + innerGap * 2) +
      outerPadding * 2;
    const x = Math.round((config.width - outerWidth) / 2);
    const bottomMargin = Math.max(42, Math.round(config.height * 0.075));
    const y = config.height - bottomMargin - outerHeight;
    const start = Math.max(0, (interval.startMs - trimStartMs) / 1000);
    const end = Math.min(durationSeconds, (interval.endMs - trimStartMs) / 1000);
    const fade = "\\fad(90,180)";
    const outerPath = roundedRectanglePath(outerWidth, outerHeight, 20);

    events.push(
      dialogue(
        100,
        start,
        end,
        "Drawing",
        `{${fade}\\an7\\pos(${x},${y + 7})\\p1\\bord0\\blur10\\1c&H000000&\\1a&H70&}${outerPath}`,
      ),
      dialogue(
        101,
        start,
        end,
        "Drawing",
        `{${fade}\\an7\\pos(${x},${y})\\p1\\bord1\\3c&H4C4C4C&\\3a&H70&\\1c&H171717&\\1a&H16&}${outerPath}`,
      ),
    );

    let cursorX = x + outerPadding;
    for (const [index, label] of labels.entries()) {
      const width = keyWidths[index] ?? 50;
      const capY = y + outerPadding;
      const capPath = roundedRectanglePath(width, keyHeight, 12);
      events.push(
        dialogue(
          102,
          start,
          end,
          "Drawing",
          `{${fade}\\an7\\pos(${number(cursorX)},${number(capY)})\\p1\\bord1\\3c&H555555&\\3a&H86&\\1c&H2A2A2A&\\1a&H20&}${capPath}`,
        ),
        dialogue(
          104,
          start,
          end,
          "KeyboardLabel",
          `{${fade}\\an5\\pos(${number(cursorX + width / 2)},${number(capY + keyHeight / 2 - 1)})\\bord0\\1c&HFFFFFF&}${safeText(label)}`,
        ),
      );
      cursorX += width;
      if (index < labels.length - 1) {
        cursorX += innerGap;
        events.push(
          dialogue(
            103,
            start,
            end,
            "KeyboardSeparator",
            `{${fade}\\an5\\pos(${number(cursorX + separatorWidth / 2)},${number(capY + keyHeight / 2 - 1)})\\bord0\\1c&H9A9A9A&}+`,
          ),
        );
        cursorX += separatorWidth + innerGap;
      }
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
    "Style: Drawing,Inter,16,&H00000000,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1",
    "Style: KeyboardLabel,Inter Medium,27,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1",
    "Style: KeyboardSeparator,Inter Medium,22,&H009A9A9A,&H009A9A9A,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}
