import { z } from "zod";
import type { Viewport } from "./recording.js";

export const backgroundPresetNames = [
  "midnight",
  "ocean",
  "aurora",
  "prism",
  "daybreak",
  "tahoe",
  "mist",
] as const;

export type BackgroundPreset = (typeof backgroundPresetNames)[number];
export type BackgroundOptions =
  | { type: "preset"; name: BackgroundPreset }
  | { type: "color"; color: string }
  | { type: "gradient"; angle?: number | undefined; colors: string[] };

export type ResolvedGradientStop = { color: string; position: number };
export type ResolvedBackground =
  | { type: "color"; color: string }
  | { type: "gradient"; angle: number; stops: ResolvedGradientStop[] };

type PresetDefinition = Omit<Extract<ResolvedBackground, { type: "gradient" }>, "type">;

const presets: Record<BackgroundPreset, PresetDefinition> = {
  midnight: {
    angle: 145,
    stops: [
      { color: "#253858", position: 0 },
      { color: "#111522", position: 0.52 },
      { color: "#0b1918", position: 1 },
    ],
  },
  ocean: {
    angle: 140,
    stops: [
      { color: "#164e63", position: 0 },
      { color: "#172554", position: 0.52 },
      { color: "#07111f", position: 1 },
    ],
  },
  aurora: {
    angle: 135,
    stops: [
      { color: "#4c1d95", position: 0 },
      { color: "#164e63", position: 0.52 },
      { color: "#052e2b", position: 1 },
    ],
  },
  prism: {
    angle: 118,
    stops: [
      { color: "#ff6b6b", position: 0 },
      { color: "#c44cff", position: 0.32 },
      { color: "#526dff", position: 0.66 },
      { color: "#18cde3", position: 1 },
    ],
  },
  daybreak: {
    angle: 132,
    stops: [
      { color: "#ff875e", position: 0 },
      { color: "#ffc766", position: 0.3 },
      { color: "#d488ff", position: 0.62 },
      { color: "#557dff", position: 1 },
    ],
  },
  tahoe: {
    angle: 122,
    stops: [
      { color: "#c9ccc5", position: 0 },
      { color: "#8eb4c9", position: 0.14 },
      { color: "#5e9acc", position: 0.29 },
      { color: "#377ac6", position: 0.43 },
      { color: "#1c4bc0", position: 0.58 },
      { color: "#123176", position: 0.72 },
      { color: "#051243", position: 0.86 },
      { color: "#376292", position: 1 },
    ],
  },
  mist: {
    angle: 128,
    stops: [
      { color: "#eef2f7", position: 0 },
      { color: "#cdd8e6", position: 0.55 },
      { color: "#a9bcd2", position: 1 },
    ],
  },
};

export function resolveBackground(options?: BackgroundOptions): ResolvedBackground {
  const selected: BackgroundOptions = options ?? { type: "preset", name: "tahoe" };
  switch (selected.type) {
    case "preset":
      return { type: "gradient", ...presets[selected.name] };
    case "color":
      return { type: "color", color: selected.color.toLowerCase() };
    case "gradient":
      return {
        type: "gradient",
        angle: selected.angle ?? 135,
        stops: selected.colors.map((color, index) => ({
          color: color.toLowerCase(),
          position: index / (selected.colors.length - 1),
        })),
      };
  }
}

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Expected a #RRGGBB color");

export const backgroundOptionsSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("preset"), name: z.enum(backgroundPresetNames) }),
  z.object({ type: z.literal("color"), color: hexColorSchema }),
  z.object({
    type: z.literal("gradient"),
    angle: z.number().finite().optional(),
    colors: z.array(hexColorSchema).min(2).max(4),
  }),
]);

export type CanvasOptions = {
  aspectRatio?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  padding?: number | undefined;
  paddingMode?: "minimum" | "exact" | undefined;
  background?: BackgroundOptions | undefined;
};

export type ResolvedCanvas = {
  width: number;
  height: number;
  padding: number;
  paddingMode: "minimum" | "exact";
};

const DEFAULT_PADDING = 97.2;

function even(value: number): number {
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function ratioFromText(value: string, source: Pick<Viewport, "width" | "height">): number {
  if (value === "source") return source.width / source.height;
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(value);
  if (!match)
    throw new Error(`Canvas aspect ratio must be "source" or WIDTH:HEIGHT, received ${value}`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!(width > 0) || !(height > 0)) throw new Error("Canvas aspect ratio values must be positive");
  return width / height;
}

function resolved(
  width: number,
  height: number,
  options: CanvasOptions | undefined,
): ResolvedCanvas {
  return {
    width: even(width),
    height: even(height),
    padding: options?.padding ?? DEFAULT_PADDING,
    paddingMode: options?.paddingMode ?? "minimum",
  };
}

export function resolveCanvas(
  options: CanvasOptions | undefined,
  source: Pick<Viewport, "width" | "height">,
): ResolvedCanvas {
  if (options?.width !== undefined || options?.height !== undefined) {
    if (options.width === undefined || options.height === undefined)
      throw new Error("Canvas width and height must be specified together");
    return resolved(options.width, options.height, options);
  }

  const aspectRatio = options?.aspectRatio ?? "16:9";
  if (aspectRatio === "16:9") return resolved(1920, 1080, options);
  if (aspectRatio === "1:1") return resolved(1080, 1080, options);
  if (aspectRatio === "9:16") return resolved(1080, 1920, options);

  const ratio = ratioFromText(aspectRatio, source);
  const [width, height] = ratio >= 1 ? [1920, 1920 / ratio] : [1920 * ratio, 1920];
  return resolved(width, height, options);
}

/* ------------------------------------------------------------------ */
/* Anchors and presentation.json                                       */
/* ------------------------------------------------------------------ */

export const anchorSchema = z.union([
  z.strictObject({ anchor: z.enum(["start", "end"]) }),
  z.strictObject({ step: z.number().int().positive(), offsetMs: z.number().finite().optional() }),
]);

export type Anchor = z.infer<typeof anchorSchema>;

const leadMs = z.number().finite().nonnegative().optional();
const holdMs = z.number().finite().nonnegative().optional();
const scale = z.number().finite().min(1);

export const zoomSchema = z.union([
  z.strictObject({ step: z.number().int().positive(), leadMs, holdMs, scale }),
  z.strictObject({
    fromStep: z.number().int().positive(),
    toStep: z.number().int().positive(),
    leadMs,
    holdMs,
    scale,
  }),
]);

export type Zoom = z.infer<typeof zoomSchema>;

export const trimSchema = z.strictObject({
  from: anchorSchema,
  to: anchorSchema,
});

export type Trim = z.infer<typeof trimSchema>;

export const browserFrameSchema = z.strictObject({ theme: z.enum(["light", "dark"]) });
export type BrowserFrame = z.infer<typeof browserFrameSchema>;

const canvasBackgroundSchema = z.union([
  hexColorSchema,
  z.enum(backgroundPresetNames),
  z.object({ type: z.literal("preset"), name: z.enum(backgroundPresetNames) }),
]);

export const canvasSchema = z
  .strictObject({
    aspectRatio: z
      .string()
      .regex(/^(?:source|\d+(?:\.\d+)?:\d+(?:\.\d+)?)$/)
      .optional(),
    width: z.number().int().positive().max(7680).optional(),
    height: z.number().int().positive().max(7680).optional(),
    padding: z.number().int().nonnegative().max(2000).optional(),
    paddingMode: z.enum(["minimum", "exact"]).optional(),
    background: canvasBackgroundSchema.optional(),
  })
  .refine((canvas) => (canvas.width === undefined) === (canvas.height === undefined), {
    message: "Canvas width and height must be specified together",
  });

export type PresentationCanvas = z.infer<typeof canvasSchema>;

export const presentationSchema = z.strictObject({
  version: z.literal(1),
  canvas: canvasSchema.optional(),
  trim: trimSchema.optional(),
  zooms: z.array(zoomSchema).optional(),
  browserFrame: browserFrameSchema.optional(),
});

export type Presentation = z.infer<typeof presentationSchema>;

export function parsePresentation(input: unknown): Presentation {
  return presentationSchema.parse(input);
}

export function canvasBackgroundToOptions(
  background: PresentationCanvas["background"],
): BackgroundOptions | undefined {
  if (background === undefined) return undefined;
  if (typeof background === "string") {
    return background.startsWith("#")
      ? { type: "color", color: background }
      : { type: "preset", name: background as BackgroundPreset };
  }
  return { type: "preset", name: background.name };
}

export function canvasToOptions(canvas: PresentationCanvas | undefined): CanvasOptions | undefined {
  if (!canvas) return undefined;
  return {
    ...canvas,
    background: canvasBackgroundToOptions(canvas.background),
  };
}

/* ------------------------------------------------------------------ */
/* Render configuration                                               */
/* ------------------------------------------------------------------ */

export const ENTER_DURATION_MS = 350;
export const EXIT_DURATION_MS = 450;

export type RenderConfig = {
  width: number;
  height: number;
  fps: number;
  padding: number;
  paddingMode: "minimum" | "exact";
  background: ResolvedBackground;
  browserFrameTheme: "light" | "dark";
  cursorEnabled: boolean;
  zoom: { enterDurationMs: number; exitDurationMs: number };
};

export function resolveRenderConfig(input: {
  viewport: Pick<Viewport, "width" | "height">;
  canvas?: CanvasOptions | undefined;
  browserFrameTheme?: "light" | "dark" | undefined;
  cursorEnabled?: boolean | undefined;
}): RenderConfig {
  const canvas = resolveCanvas(input.canvas, input.viewport);
  return {
    ...canvas,
    fps: 60,
    background: resolveBackground(input.canvas?.background),
    browserFrameTheme: input.browserFrameTheme ?? "dark",
    cursorEnabled: input.cursorEnabled ?? true,
    zoom: { enterDurationMs: ENTER_DURATION_MS, exitDurationMs: EXIT_DURATION_MS },
  };
}

export const defaultConfig = {
  recording: { viewport: { width: 1440, height: 900 } },
  render: resolveRenderConfig({ viewport: { width: 1440, height: 900 } }),
  cursor: { enabled: true },
  zoom: { enterDurationMs: ENTER_DURATION_MS, exitDurationMs: EXIT_DURATION_MS },
};
