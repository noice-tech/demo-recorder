import type { Viewport } from "../recording/types.js";

export type Point = { x: number; y: number };

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function containRect(source: Pick<Viewport, "width" | "height">, container: Rect): Rect {
  if (source.width <= 0 || source.height <= 0 || container.width <= 0 || container.height <= 0) {
    throw new Error("Source and container dimensions must be positive");
  }

  const scale = Math.min(container.width / source.width, container.height / source.height);
  const width = source.width * scale;
  const height = source.height * scale;

  return {
    x: container.x + (container.width - width) / 2,
    y: container.y + (container.height - height) / 2,
    width,
    height,
  };
}

export function clampPointToRect(point: Point, rect: Rect): Point {
  return {
    x: Math.min(rect.x + rect.width, Math.max(rect.x, point.x)),
    y: Math.min(rect.y + rect.height, Math.max(rect.y, point.y)),
  };
}

export function projectViewportPoint(
  point: Point,
  viewport: Pick<Viewport, "width" | "height">,
  contentRect: Rect,
): Point {
  if (viewport.width <= 0 || viewport.height <= 0) {
    throw new Error("Viewport dimensions must be positive");
  }

  return clampPointToRect(
    {
      x: contentRect.x + (point.x / viewport.width) * contentRect.width,
      y: contentRect.y + (point.y / viewport.height) * contentRect.height,
    },
    contentRect,
  );
}
