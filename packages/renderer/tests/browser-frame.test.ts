import { describe, expect, it } from "vitest";
import {
  browserCornerRadius,
  computeBrowserFrameLayout,
  drawBrowserFrame,
  formatBrowserAddress,
} from "../src/frames.js";

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
    expect(right(layout.navigation)).toBeLessThanOrEqual(layout.address.x);
    if (layout.sidebar) expect(right(layout.sidebar)).toBeLessThanOrEqual(layout.navigation.x);
    if (layout.forward) expect(right(layout.back)).toBeLessThanOrEqual(layout.forward.x);
    expect(Boolean(layout.sidebar)).toBe(density === "full");
    expect(Boolean(layout.forward)).toBe(density !== "narrow");
    expect(right(layout.address)).toBeLessThanOrEqual(layout.actions.group.x);
    expect(right(layout.actions.group)).toBeLessThanOrEqual(browser.x + browser.width);
    expect(layout.addressText.x).toBeGreaterThanOrEqual(layout.address.x);
    expect(right(layout.addressText)).toBeLessThanOrEqual(right(layout.address));
  });

  it("draws the frame and every requested browser control", () => {
    const layout = computeBrowserFrameLayout({ x: 20, y: 30, width: 1340, height: 886 });
    const drawings = drawBrowserFrame(layout, "dark");

    expect(drawings).toHaveLength(19);
    expect(drawings.every((drawing) => drawing.text.includes("\\p1"))).toBe(true);
    expect(drawings.filter((drawing) => drawing.layer === 6)).toHaveLength(9);
    expect(drawings.filter((drawing) => drawing.layer === 6)[6]!.text).toContain("\\1a&H88&");
  });

  it.each(["light", "dark"] as const)(
    "renders toolbar actions as filled strokes in %s mode",
    (theme) => {
      const layout = computeBrowserFrameLayout({ x: 20, y: 30, width: 1340, height: 886 });
      const controls = drawBrowserFrame(layout, theme).filter((drawing) => drawing.layer === 6);
      // Back, share, new tab, tabs, shield, reload. The shield remains a closed outline.
      for (const index of [0, 1, 2, 3, 5]) {
        expect(controls[index]!.text).toContain("\\p1\\bord0\\1c&");
        expect(controls[index]!.text).not.toContain("\\1a&HFF&");
      }
      expect(controls[1]!.text).not.toBe(controls[3]!.text);
    },
  );

  it("matches the reference icon silhouettes", () => {
    const layout = computeBrowserFrameLayout({ x: 20, y: 30, width: 1340, height: 886 });
    const controls = drawBrowserFrame(layout, "light").filter((drawing) => drawing.layer === 6);
    // The share box has two shoulders, leaving an opening around its arrow.
    expect(controls[1]!.text).toContain("m 5.5 6.1 l 4.5 6.1");
    expect(controls[1]!.text).toContain("m 11.5 6.1 l 10.5 6.1");
    // Front tab sits below and to the right of the rear tab.
    expect(controls[3]!.text).toContain("m 3 0.9 l 9.5 0.9");
    expect(controls[3]!.text).toContain("m 6.5 4.4 l 13 4.4");
    // Reload uses a single continuous Bézier silhouette, not overlapping strokes.
    expect(controls[5]!.text.match(/\bm /g)).toHaveLength(1);
    expect(controls[5]!.text).toContain("m 8 3.8 b 5.128 3.8");
    expect(controls[5]!.text).toContain("l 10 4.8 b 10.22 4.58 10.22 4.22 10 4");
  });

  it("groups toolbar controls with pill surfaces and shared window corners", () => {
    const layout = computeBrowserFrameLayout({ x: 20, y: 30, width: 1340, height: 886 });
    const drawings = drawBrowserFrame(layout, "light");
    const fields = drawings.filter((drawing) => drawing.layer === 4);
    expect(fields).toHaveLength(4);
    expect(fields[0]!.text).toContain(`\\pos(${layout.address.x},${layout.address.y})`);
    expect(fields[0]!.text).toContain("m 15 0");
    expect(drawings[0]!.text).toContain(`m ${browserCornerRadius(layout.browser)} 0`);
    expect(browserCornerRadius(layout.browser)).toBe(20);
    const outline = drawings.find((drawing) => drawing.layer === 2)!;
    expect(outline.text).toContain("\\bord0.5\\blur0.3");
    expect(outline.text).toContain("\\3a&H90&");
  });

  it("supports dark and light frame palettes", () => {
    const layout = computeBrowserFrameLayout({ x: 20, y: 30, width: 936, height: 634 });
    const dark = drawBrowserFrame(layout, "dark")
      .map((drawing) => drawing.text)
      .join("\n");
    const light = drawBrowserFrame(layout, "light")
      .map((drawing) => drawing.text)
      .join("\n");

    expect(dark).toContain("\\1c&H211F1E&");
    expect(light).toContain("\\1c&HF2EFF0&");
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
