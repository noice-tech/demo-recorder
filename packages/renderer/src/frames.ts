import {
  containRect,
  type Rect,
  type ResolvedBackground,
  type Viewport,
} from "@noice-tech/demo-recorder-core";

// ---------------------------------------------------------------------------
// Canvas geometry
// ---------------------------------------------------------------------------

export const BROWSER_TITLE_BAR_HEIGHT = 48;

export type ProductDemoGeometry = {
  content: Rect;
  browser: Rect;
};

function even(value: number): number {
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

export function productDemoGeometry(
  viewport: Pick<Viewport, "width" | "height">,
  output: {
    width: number;
    height: number;
    padding: number;
    paddingMode: "minimum" | "exact";
  },
): ProductDemoGeometry {
  if (
    output.padding * 2 >= output.width ||
    output.padding * 2 + BROWSER_TITLE_BAR_HEIGHT >= output.height
  )
    throw new Error("Canvas padding leaves no room for the browser frame");
  const available = {
    x: output.padding,
    y: output.padding + BROWSER_TITLE_BAR_HEIGHT,
    width: output.width - output.padding * 2,
    height: output.height - output.padding * 2 - BROWSER_TITLE_BAR_HEIGHT,
  };
  const availableRatio = available.width / available.height;
  const viewportRatio = viewport.width / viewport.height;
  if (output.paddingMode === "exact" && Math.abs(viewportRatio / availableRatio - 1) > 0.002) {
    throw new Error(
      `Exact ${output.padding}px padding requires a capture viewport ratio near ${availableRatio.toFixed(4)}; received ${viewport.width}x${viewport.height}`,
    );
  }
  const raw = output.paddingMode === "exact" ? available : containRect(viewport, available);
  const content = {
    x: Math.round(raw.x),
    y: Math.round(raw.y),
    width: even(raw.width),
    height: even(raw.height),
  };
  return {
    content,
    browser: {
      x: content.x,
      y: content.y - BROWSER_TITLE_BAR_HEIGHT,
      width: content.width,
      height: content.height + BROWSER_TITLE_BAR_HEIGHT,
    },
  };
}

// ---------------------------------------------------------------------------
// Background raster
// ---------------------------------------------------------------------------

type Rgb = readonly [number, number, number];
type RgbStop = { color: Rgb; position: number };
type PixelSampler = (x: number, y: number) => Rgb;

function parseHex(color: string): Rgb {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

function colorAt(stops: RgbStop[], position: number): Rgb {
  const endIndex = stops.findIndex((stop) => position <= stop.position);
  if (endIndex < 0) return stops.at(-1)!.color;
  if (endIndex === 0) return stops[0]!.color;

  const start = stops[endIndex - 1]!;
  const end = stops[endIndex]!;
  const progress = (position - start.position) / (end.position - start.position || 1);
  const mix = (channel: number) =>
    Math.round(start.color[channel]! + (end.color[channel]! - start.color[channel]!) * progress);
  return [mix(0), mix(1), mix(2)];
}

function createPixelSampler(
  width: number,
  height: number,
  background: ResolvedBackground,
): PixelSampler {
  if (background.type === "color") {
    const color = parseHex(background.color);
    return () => color;
  }

  const stops = background.stops.map((stop) => ({
    color: parseHex(stop.color),
    position: stop.position,
  }));
  const radians = (background.angle * Math.PI) / 180;
  const axisX = Math.sin(radians);
  const axisY = -Math.cos(radians);
  const extent = Math.abs(axisX) * width + Math.abs(axisY) * height;
  return (x, y) => {
    const projection = (x + 0.5 - width / 2) * axisX + (y + 0.5 - height / 2) * axisY;
    const position = Math.max(0, Math.min(1, 0.5 + projection / extent));
    return colorAt(stops, position);
  };
}

/** Generates a single binary PPM frame without browser or native image dependencies. */
export function generateBackgroundRaster(
  width: number,
  height: number,
  background: ResolvedBackground,
): Buffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("Background dimensions must be positive integers");
  }

  const header = Buffer.from(`P6\n${width} ${height}\n255\n`, "ascii");
  const pixels = Buffer.allocUnsafe(width * height * 3);
  const sample = createPixelSampler(width, height, background);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = sample(x, y);
      pixels[offset++] = color[0];
      pixels[offset++] = color[1];
      pixels[offset++] = color[2];
    }
  }
  return Buffer.concat([header, pixels]);
}

// ---------------------------------------------------------------------------
// Browser frame overlay drawings
// ---------------------------------------------------------------------------

export type BrowserFrameDensity = "full" | "compact" | "narrow";
export type BrowserFrameTheme = "dark" | "light";

export type BrowserFrameLayout = {
  browser: Rect;
  toolbarHeight: number;
  density: BrowserFrameDensity;
  scale: number;
  trafficLights: readonly { x: number; y: number; radius: number }[];
  back: Rect;
  forward: Rect | undefined;
  navigation: Rect;
  sidebar: Rect | undefined;
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

const TOOLBAR_HEIGHT = BROWSER_TITLE_BAR_HEIGHT;

/** Shared by the toolbar, window outline, content mask, and shadow. */
export function browserCornerRadius(browser: Rect): number {
  return rounded(clamp((20 * browser.width) / 1340, 14, 24));
}

const framePalettes = {
  dark: {
    toolbar: "H211F1E",
    frameBorder: "H686868",
    separator: "H171717",
    capsule: "H2D2A28",
    capsuleBorder: "H626262",
    glyph: "HD6D3D1",
    addressText: "HD6D6D6",
  },
  light: {
    toolbar: "HF2EFF0",
    frameBorder: "H929292",
    separator: "HB8B8B8",
    capsule: "HFAFAFA",
    capsuleBorder: "HBBBBBB",
    glyph: "H454545",
    addressText: "H4A4A4A",
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
  const leftX = browser.x + outerInset + (density === "narrow" ? 0 : clamp(66 * scale, 52, 69));
  const sidebar =
    density === "full" ? rect(leftX, controlY, actionWidth * 1.6, controlHeight) : undefined;
  const navigationX = sidebar ? sidebar.x + sidebar.width + groupGap : leftX;
  const back = rect(navigationX, controlY, actionWidth, controlHeight);
  const forward =
    density === "narrow"
      ? undefined
      : rect(navigationX + actionWidth, controlY, actionWidth, controlHeight);
  const navigation = rect(navigationX, controlY, actionWidth * (forward ? 2 : 1), controlHeight);
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

  const safeLeft = navigation.x + navigation.width + groupGap;
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
    forward,
    navigation,
    sidebar,
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
    `b ${number(radius - control)} ${number(diameter)} 0 ${number(radius + control)} 0 ${number(radius)} ${number(diameter)}`,
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
    `\\bord0.75\\1a&HFF&\\3c&${framePalettes[theme].glyph}&\\3a&H08&\\j1`,
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

type IconPoint = readonly [number, number];

// libass implicitly closes open contours. Expand strokes into filled, round-ended
// segments instead of using borders on open paths (which introduce diagonals).
function roundStrokePath(points: readonly IconPoint[], width = 1.2): string {
  const radius = width / 2;
  const contours: string[] = [];
  const polygon = (vertices: readonly IconPoint[]) =>
    `m ${vertices.map(([x, y]) => `${number(x)} ${number(y)}`).join(" l ")}`;
  for (let index = 1; index < points.length; index += 1) {
    const [ax, ay] = points[index - 1]!;
    const [bx, by] = points[index]!;
    const length = Math.hypot(bx - ax, by - ay);
    if (length === 0) continue;
    const nx = ((by - ay) / length) * radius;
    const ny = ((ax - bx) / length) * radius;
    contours.push(
      polygon([
        [ax + nx, ay + ny],
        [bx + nx, by + ny],
        [bx - nx, by - ny],
        [ax - nx, ay - ny],
      ]),
    );
  }
  for (const [x, y] of points) {
    contours.push(
      polygon(
        Array.from({ length: 12 }, (_, index): IconPoint => {
          const angle = (index / 12) * Math.PI * 2;
          return [x + Math.cos(angle) * radius, y + Math.sin(angle) * radius];
        }),
      ),
    );
  }
  return contours.join(" ");
}

function reloadIconDrawings(value: Rect, theme: BrowserFrameTheme): BrowserFrameDrawing[] {
  // One continuous filled silhouette: smooth circular Béziers and an integrated
  // chevron. Overlapping stroke contours made the old arc/arrow junction ragged.
  const path = [
    "m 8 3.8",
    "b 5.128 3.8 2.8 6.128 2.8 9",
    "b 2.8 11.872 5.128 14.2 8 14.2",
    "b 10.872 14.2 13.2 11.872 13.2 9",
    "b 13.2 8.2 12 8.2 12 9",
    "b 12 11.209 10.209 13 8 13",
    "b 5.791 13 4 11.209 4 9",
    "b 4 6.791 5.791 5 8 5",
    "l 8.1 5 l 6.7 6.4",
    "b 6.15 6.95 7 7.8 7.55 7.25",
    "l 10 4.8 b 10.22 4.58 10.22 4.22 10 4",
    "l 7.55 1.55 b 7 1 6.15 1.85 6.7 2.4",
    "l 8.1 3.8 l 8 3.8",
  ].join(" ");
  return [{ layer: 6, text: filledIconDrawing(value, path, theme) }];
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
        roundedTopRectPath(browser.width, layout.toolbarHeight, browserCornerRadius(browser)),
      ),
    },
    {
      layer: 2,
      text: drawingAt(
        browser,
        `\\bord0.5\\blur0.3\\1a&HFF&\\3c&${palette.frameBorder}&\\3a&H90&`,
        roundedRectPath(browser.width, browser.height, browserCornerRadius(browser)),
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
    { layer: 4, text: capsuleDrawing(layout.address, theme) },
    { layer: 4, text: capsuleDrawing(layout.navigation, theme) },
    { layer: 4, text: capsuleDrawing(layout.actions.group, theme) },
    ...(layout.sidebar ? [{ layer: 4, text: capsuleDrawing(layout.sidebar, theme) }] : []),
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
      "m 10.5 2 l 4.5 8 l 10.5 14 l 11.6 12.9 l 6.7 8 l 11.6 3.1 l 10.5 2",
      theme,
      -1.5,
    ),
  });
  drawings.push({
    layer: 6,
    text: filledIconDrawing(
      layout.actions.share,
      [
        roundStrokePath([
          [5.5, 5.5],
          [4.5, 5.5],
          [3.75, 5.7],
          [3.2, 6.25],
          [3, 7],
          [3, 12.5],
          [3.2, 13.25],
          [3.75, 13.8],
          [4.5, 14],
          [11.5, 14],
          [12.25, 13.8],
          [12.8, 13.25],
          [13, 12.5],
          [13, 7],
          [12.8, 6.25],
          [12.25, 5.7],
          [11.5, 5.5],
          [10.5, 5.5],
        ]),
        roundStrokePath([
          [8, 10],
          [8, 1.5],
        ]),
        roundStrokePath([
          [5.5, 4],
          [8, 1.5],
          [10.5, 4],
        ]),
      ].join(" "),
      theme,
    ),
  });
  drawings.push({
    layer: 6,
    text: filledIconDrawing(
      layout.actions.newTab,
      [
        roundStrokePath([
          [8, 3],
          [8, 13],
        ]),
        roundStrokePath([
          [3, 8],
          [13, 8],
        ]),
      ].join(" "),
      theme,
    ),
  });
  drawings.push({
    layer: 6,
    text: filledIconDrawing(
      layout.actions.tabs,
      [
        roundStrokePath([
          // Only the exposed top and left edges of the rear square are drawn.
          [3.5, 11],
          [3, 11],
          [2.25, 10.8],
          [1.7, 10.25],
          [1.5, 9.5],
          [1.5, 3],
          [1.7, 2.25],
          [2.25, 1.7],
          [3, 1.5],
          [9.5, 1.5],
          [10.25, 1.7],
          [10.8, 2.25],
          [11, 3],
          [11, 3.5],
        ]),
        roundStrokePath([
          [6.5, 5],
          [13, 5],
          [13.75, 5.2],
          [14.3, 5.75],
          [14.5, 6.5],
          [14.5, 13],
          [14.3, 13.75],
          [13.75, 14.3],
          [13, 14.5],
          [6.5, 14.5],
          [5.75, 14.3],
          [5.2, 13.75],
          [5, 13],
          [5, 6.5],
          [5.2, 5.75],
          [5.75, 5.2],
          [6.5, 5],
        ]),
      ].join(" "),
      theme,
    ),
  });

  if (layout.showAddressAccessories) {
    const reload = rect(
      layout.address.x + layout.address.width - 29,
      layout.address.y + (layout.address.height - 28) / 2,
      28,
      28,
    );
    drawings.push(
      {
        layer: 6,
        text: iconDrawing(
          rect(layout.address.x + 4, layout.address.y, 22, layout.address.height),
          "m 8 3 l 12 5 l 12 9 b 12 12 10 14 8 15 b 6 14 4 12 4 9 l 4 5 l 8 3",
          theme,
          0,
          -1,
        ),
      },
      ...reloadIconDrawings(reload, theme),
    );
  }

  if (layout.forward) {
    drawings.push({
      layer: 6,
      text: filledIconDrawing(
        layout.forward,
        roundStrokePath([
          [5.5, 2.5],
          [11, 8],
          [5.5, 13.5],
        ]),
        theme,
      ).replace("\\bord0", "\\bord0\\1a&H88&"),
    });
  }
  if (layout.sidebar) {
    const icon = rect(layout.sidebar.x + 3, layout.sidebar.y, 24, layout.sidebar.height);
    drawings.push(
      {
        layer: 6,
        text: filledIconDrawing(
          icon,
          [
            roundStrokePath([
              [3, 2.5],
              [13, 2.5],
              [13.7, 2.8],
              [14, 3.5],
              [14, 12.5],
              [13.7, 13.2],
              [13, 13.5],
              [3, 13.5],
              [2.3, 13.2],
              [2, 12.5],
              [2, 3.5],
              [2.3, 2.8],
              [3, 2.5],
            ]),
            roundStrokePath([
              [6, 2.5],
              [6, 13.5],
            ]),
          ].join(" "),
          theme,
        ),
      },
      {
        layer: 6,
        text: filledIconDrawing(
          rect(
            layout.sidebar.x + layout.sidebar.width - 19,
            layout.sidebar.y,
            16,
            layout.sidebar.height,
          ),
          roundStrokePath([
            [5, 7],
            [8, 10],
            [11, 7],
          ]),
          theme,
        ),
      },
    );
  }
  return drawings;
}
