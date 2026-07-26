import { containRect, type Rect, type Viewport } from "@noice-tech/demo-recorder-core";

export const BROWSER_TITLE_BAR_HEIGHT = 48;
const FRAME_PADDING_X_RATIO = 0.065;
const FRAME_PADDING_Y_RATIO = 0.09;

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
  output: { width: number; height: number },
): ProductDemoGeometry {
  const paddingX = output.width * FRAME_PADDING_X_RATIO;
  const paddingY = output.height * FRAME_PADDING_Y_RATIO;
  const raw = containRect(viewport, {
    x: paddingX,
    y: paddingY + BROWSER_TITLE_BAR_HEIGHT,
    width: output.width - paddingX * 2,
    height: output.height - paddingY * 2 - BROWSER_TITLE_BAR_HEIGHT,
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
