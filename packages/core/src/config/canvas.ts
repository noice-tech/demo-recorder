import type { Viewport } from "../recording/types.js";

export type CanvasOptions = {
  aspectRatio?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  padding?: number | undefined;
};

export type ResolvedCanvas = {
  width: number;
  height: number;
  padding: number;
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

export function resolveCanvas(
  options: CanvasOptions | undefined,
  source: Pick<Viewport, "width" | "height">,
): ResolvedCanvas {
  if (options?.width !== undefined || options?.height !== undefined) {
    if (options.width === undefined || options.height === undefined)
      throw new Error("Canvas width and height must be specified together");
    return {
      width: even(options.width),
      height: even(options.height),
      padding: options.padding ?? DEFAULT_PADDING,
    };
  }

  const aspectRatio = options?.aspectRatio ?? "16:9";
  if (aspectRatio === "16:9")
    return { width: 1920, height: 1080, padding: options?.padding ?? DEFAULT_PADDING };
  if (aspectRatio === "1:1")
    return { width: 1080, height: 1080, padding: options?.padding ?? DEFAULT_PADDING };
  if (aspectRatio === "9:16")
    return { width: 1080, height: 1920, padding: options?.padding ?? DEFAULT_PADDING };

  const ratio = ratioFromText(aspectRatio, source);
  const [width, height] = ratio >= 1 ? [1920, 1920 / ratio] : [1920 * ratio, 1920];
  return { width: even(width), height: even(height), padding: options?.padding ?? DEFAULT_PADDING };
}
