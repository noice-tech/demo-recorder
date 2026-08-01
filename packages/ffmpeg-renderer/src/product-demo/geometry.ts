import { containRect, type Rect, type Viewport } from "@noice-tech/demo-recorder-core";

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
  output: { width: number; height: number; padding: number },
): ProductDemoGeometry {
  if (
    output.padding * 2 >= output.width ||
    output.padding * 2 + BROWSER_TITLE_BAR_HEIGHT >= output.height
  )
    throw new Error("Canvas padding leaves no room for the browser frame");
  const raw = containRect(viewport, {
    x: output.padding,
    y: output.padding + BROWSER_TITLE_BAR_HEIGHT,
    width: output.width - output.padding * 2,
    height: output.height - output.padding * 2 - BROWSER_TITLE_BAR_HEIGHT,
  });
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
