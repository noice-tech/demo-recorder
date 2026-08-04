import type { Rect } from "@noice-tech/demo-recorder-core";

export type BrowserFrameDensity = "full" | "compact" | "narrow";
export type BrowserFrameTheme = "dark" | "light";

export type BrowserFrameLayout = {
  browser: Rect;
  toolbarHeight: number;
  density: BrowserFrameDensity;
  scale: number;
  trafficLights: readonly { x: number; y: number; radius: number }[];
  back: Rect;
  address: Rect;
  addressText: Rect;
  showAddressAccessories: boolean;
  actions: {
    group: Rect;
    share: Rect;
    newTab: Rect;
    tabs: Rect;
  };
};

export type BrowserFrameDrawing = {
  layer: number;
  text: string;
};

const TOOLBAR_HEIGHT = 48;

const framePalettes = {
  dark: {
    toolbar: "H32241E",
    frameBorder: "H51483F",
    separator: "H493F37",
    capsule: "H403832",
    capsuleBorder: "H6B625A",
    glyph: "HECE7E2",
    addressText: "HFFFFFF",
  },
  light: {
    toolbar: "HE9E8E6",
    frameBorder: "H6D6A66",
    separator: "HB7B4B0",
    capsule: "HF8F8F8",
    capsuleBorder: "HFFFFFF",
    glyph: "H4A4A4A",
    addressText: "H2F2F2F",
  },
} as const;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function rounded(value: number): number {
  return Number(value.toFixed(2));
}

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x: rounded(x), y: rounded(y), width: rounded(width), height: rounded(height) };
}

export function computeBrowserFrameLayout(browser: Rect): BrowserFrameLayout {
  const density: BrowserFrameDensity =
    browser.width >= 900 ? "full" : browser.width >= 520 ? "compact" : "narrow";
  const scale = clamp(browser.width / 1340, 0.72, 1.08);
  const toolbarY = browser.y;
  const controlHeight = clamp(30 * scale, 26, 32);
  const controlY = toolbarY + (TOOLBAR_HEIGHT - controlHeight) / 2;
  const outerInset = clamp(14 * scale, 8, 15);
  const groupGap = clamp(10 * scale, 7, 11);
  const actionWidth = clamp(30 * scale, 25, 32);
  const actionGroupWidth = actionWidth * 3;
  const actionGroup = rect(
    browser.x + browser.width - outerInset - actionGroupWidth,
    controlY,
    actionGroupWidth,
    controlHeight,
  );
  const back = rect(
    density === "narrow"
      ? browser.x + outerInset
      : browser.x + outerInset + clamp(66 * scale, 52, 69),
    controlY,
    controlHeight,
    controlHeight,
  );
  const trafficRadius = clamp(5.5 * scale, 4.5, 6);
  const trafficGap = clamp(19 * scale, 15, 20);
  const trafficStartX = browser.x + outerInset + trafficRadius;
  const trafficLights =
    density === "narrow"
      ? []
      : [0, 1, 2].map((index) => ({
          x: rounded(trafficStartX + index * trafficGap),
          y: rounded(toolbarY + TOOLBAR_HEIGHT / 2),
          radius: rounded(trafficRadius),
        }));

  const safeLeft = back.x + back.width + groupGap;
  const safeRight = actionGroup.x - groupGap;
  const availableAddressWidth = Math.max(24, safeRight - safeLeft);
  const preferredAddressRatio = density === "full" ? 0.38 : density === "compact" ? 0.36 : 0.4;
  const preferredAddressWidth = clamp(
    browser.width * preferredAddressRatio,
    density === "narrow" ? 96 : 180,
    560,
  );
  const addressWidth = Math.min(preferredAddressWidth, availableAddressWidth);
  const centeredAddressX = browser.x + (browser.width - addressWidth) / 2;
  const addressX = clamp(centeredAddressX, safeLeft, Math.max(safeLeft, safeRight - addressWidth));
  const address = rect(addressX, controlY, addressWidth, controlHeight);
  const showAddressAccessories = address.width >= 220;
  const addressAccessoryInset = showAddressAccessories ? clamp(27 * scale, 22, 29) : 9;
  const addressText = rect(
    address.x + addressAccessoryInset,
    address.y,
    Math.max(8, address.width - addressAccessoryInset * 2),
    address.height,
  );

  return {
    browser,
    toolbarHeight: TOOLBAR_HEIGHT,
    density,
    scale,
    trafficLights,
    back,
    address,
    addressText,
    showAddressAccessories,
    actions: {
      group: actionGroup,
      share: rect(actionGroup.x, actionGroup.y, actionWidth, actionGroup.height),
      newTab: rect(actionGroup.x + actionWidth, actionGroup.y, actionWidth, actionGroup.height),
      tabs: rect(actionGroup.x + actionWidth * 2, actionGroup.y, actionWidth, actionGroup.height),
    },
  };
}

export function formatBrowserAddress(value: string, includePath: boolean): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "Product demo";
    const hostname = url.hostname.replace(/^www\./i, "") || "Product demo";
    if (!includePath || url.pathname === "/") return hostname;
    let pathname = url.pathname;
    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      // Keep the encoded pathname when it contains an invalid escape sequence.
    }
    pathname = [...pathname]
      .filter((character) => {
        const code = character.charCodeAt(0);
        return code >= 32 && code !== 127;
      })
      .join("");
    const path = pathname.length > 42 ? `${pathname.slice(0, 39)}…` : pathname;
    return `${hostname}${path}`;
  } catch {
    return "Product demo";
  }
}

function number(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function roundedTopRectPath(width: number, height: number, radius: number): string {
  const control = radius * 0.55228475;
  return [
    `m ${number(radius)} 0`,
    `l ${number(width - radius)} 0`,
    `b ${number(width - radius + control)} 0 ${number(width)} ${number(radius - control)} ${number(width)} ${number(radius)}`,
    `l ${number(width)} ${number(height)}`,
    `l 0 ${number(height)}`,
    `l 0 ${number(radius)}`,
    `b 0 ${number(radius - control)} ${number(radius - control)} 0 ${number(radius)} 0`,
  ].join(" ");
}

function roundedRectPath(width: number, height: number, radius: number): string {
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

function drawingAt(position: Pick<Rect, "x" | "y">, tags: string, path: string): string {
  return `{\\an7\\pos(${number(position.x)},${number(position.y)})\\p1${tags}}${path}`;
}

function capsuleDrawing(value: Rect, theme: BrowserFrameTheme): string {
  const palette = framePalettes[theme];
  return drawingAt(
    value,
    `\\bord1\\blur0.35\\1c&${palette.capsule}&\\1a&H18&\\3c&${palette.capsuleBorder}&\\3a&H78&`,
    roundedRectPath(value.width, value.height, value.height / 2),
  );
}

function iconDrawing(
  value: Rect,
  path: string,
  theme: BrowserFrameTheme,
  offsetX = 0,
  offsetY = 0,
): string {
  return drawingAt(
    { x: value.x + value.width / 2 - 8 + offsetX, y: value.y + value.height / 2 - 8 + offsetY },
    `\\bord1.35\\1a&HFF&\\3c&${framePalettes[theme].glyph}&\\3a&H08&\\j1`,
    path,
  );
}

function filledIconDrawing(
  value: Rect,
  path: string,
  theme: BrowserFrameTheme,
  offsetX = 0,
): string {
  return drawingAt(
    { x: value.x + value.width / 2 - 8 + offsetX, y: value.y + value.height / 2 - 8 },
    `\\bord0\\1c&${framePalettes[theme].glyph}&`,
    path,
  );
}

export function browserFrameAddressColor(theme: BrowserFrameTheme): string {
  return framePalettes[theme].addressText;
}

export function drawBrowserFrame(
  layout: BrowserFrameLayout,
  theme: BrowserFrameTheme,
): BrowserFrameDrawing[] {
  const browser = layout.browser;
  const palette = framePalettes[theme];
  const drawings: BrowserFrameDrawing[] = [
    {
      layer: 1,
      text: drawingAt(
        browser,
        `\\bord0\\1c&${palette.toolbar}&`,
        roundedTopRectPath(browser.width, layout.toolbarHeight, 20),
      ),
    },
    {
      layer: 2,
      text: drawingAt(
        browser,
        `\\bord1\\1a&HFF&\\3c&${palette.frameBorder}&\\3a&H58&`,
        roundedRectPath(browser.width, browser.height, 20),
      ),
    },
    {
      layer: 3,
      text: drawingAt(
        { x: browser.x, y: browser.y + layout.toolbarHeight - 1 },
        `\\bord0\\1c&${palette.separator}&\\1a&H68&`,
        `m 0 0 l ${number(browser.width)} 0 l ${number(browser.width)} 1 l 0 1`,
      ),
    },
    { layer: 4, text: capsuleDrawing(layout.back, theme) },
    { layer: 4, text: capsuleDrawing(layout.address, theme) },
    { layer: 4, text: capsuleDrawing(layout.actions.group, theme) },
  ];

  const trafficColors = ["H5B5FFF", "H35BDFE", "H4BCB2B"];
  for (const [index, light] of layout.trafficLights.entries()) {
    drawings.push({
      layer: 5,
      text: drawingAt(
        { x: light.x - light.radius, y: light.y - light.radius },
        `\\bord0.7\\3c&H6B625A&\\3a&H80&\\1c&${trafficColors[index]}&`,
        circlePath(light.radius),
      ),
    });
  }

  drawings.push({
    layer: 6,
    text: filledIconDrawing(
      layout.back,
      "m 11 2 l 5 8 l 11 14 l 13 12 l 9 8 l 13 4 l 11 2",
      theme,
      -1.125,
    ),
  });
  drawings.push({
    layer: 6,
    text: iconDrawing(
      layout.actions.share,
      "m 3 9 l 3 14 l 13 14 l 13 9 m 8 10 l 8 2 m 4 6 l 8 2 l 12 6",
      theme,
    ),
  });
  drawings.push({
    layer: 6,
    text: iconDrawing(layout.actions.newTab, "m 8 3 l 8 13 m 3 8 l 13 8", theme),
  });
  drawings.push({
    layer: 6,
    text: iconDrawing(
      layout.actions.tabs,
      "m 6 2 l 14 2 l 14 10 l 11 10 m 2 6 l 10 6 l 10 14 l 2 14 l 2 6",
      theme,
    ),
  });

  if (layout.showAddressAccessories) {
    drawings.push({
      layer: 6,
      text: iconDrawing(
        rect(layout.address.x + 4, layout.address.y, 22, layout.address.height),
        "m 8 3 l 12 5 l 12 9 b 12 12 10 14 8 15 b 6 14 4 12 4 9 l 4 5 l 8 3",
        theme,
      ),
    });
  }

  return drawings;
}
