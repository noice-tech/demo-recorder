import { describe, expect, it } from "vitest";
import {
  computeBrowserFrameLayout,
  drawBrowserFrame,
  formatBrowserAddress,
} from "../src/product-demo/browser-frame.js";

function right(rectangle: { x: number; width: number }): number {
  return rectangle.x + rectangle.width;
}

describe("browser frame layout", () => {
  it.each([
    [1340, "full", true],
    [936, "full", true],
    [700, "compact", true],
    [420, "narrow", false],
    [180, "narrow", false],
  ] as const)("keeps controls separated at %ipx", (width, density, showsTrafficLights) => {
    const browser = { x: 30, y: 40, width, height: 700 };
    const layout = computeBrowserFrameLayout(browser);

    expect(layout.density).toBe(density);
    expect(layout.trafficLights.length > 0).toBe(showsTrafficLights);
    expect(layout.back.x).toBeGreaterThanOrEqual(browser.x);
    expect(right(layout.back)).toBeLessThanOrEqual(layout.address.x);
    expect(right(layout.address)).toBeLessThanOrEqual(layout.actions.group.x);
    expect(right(layout.actions.group)).toBeLessThanOrEqual(browser.x + browser.width);
    expect(layout.addressText.x).toBeGreaterThanOrEqual(layout.address.x);
    expect(right(layout.addressText)).toBeLessThanOrEqual(right(layout.address));
  });

  it("draws the frame and every requested browser control", () => {
    const layout = computeBrowserFrameLayout({ x: 20, y: 30, width: 1340, height: 886 });
    const drawings = drawBrowserFrame(layout, "dark");

    expect(drawings.length).toBeGreaterThanOrEqual(14);
    expect(drawings.every((drawing) => drawing.text.includes("\\p1"))).toBe(true);
    expect(drawings.map((drawing) => drawing.layer)).toContain(6);
    expect(drawings.map((drawing) => drawing.text).join("\n")).toContain(
      "m 11.78 6.54 l 12.02 5.06 l 15.22 5.56",
    );
  });

  it("supports dark and light frame palettes", () => {
    const layout = computeBrowserFrameLayout({ x: 20, y: 30, width: 936, height: 634 });
    const dark = drawBrowserFrame(layout, "dark")
      .map((drawing) => drawing.text)
      .join("\n");
    const light = drawBrowserFrame(layout, "light")
      .map((drawing) => drawing.text)
      .join("\n");

    expect(dark).toContain("\\1c&H32241E&");
    expect(light).toContain("\\1c&HE9E8E6&");
    expect(dark).not.toBe(light);
  });
});

describe("browser address formatting", () => {
  it("shows a browser-like host and optional path", () => {
    expect(formatBrowserAddress("https://www.example.com/products/widgets", true)).toBe(
      "example.com/products/widgets",
    );
    expect(formatBrowserAddress("https://www.example.com/products/widgets", false)).toBe(
      "example.com",
    );
  });

  it("does not expose credentials, query parameters, or fragments", () => {
    expect(
      formatBrowserAddress("https://user:secret@example.com/private?token=sensitive#account", true),
    ).toBe("example.com/private");
  });

  it("uses a stable fallback for malformed and unsupported URLs", () => {
    expect(formatBrowserAddress("not a URL", true)).toBe("Product demo");
    expect(formatBrowserAddress("file:///private/demo.html", true)).toBe("Product demo");
  });
});
