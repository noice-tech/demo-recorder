import { describe, expect, it } from "vitest";
import { productDemoGeometry } from "../src/index.js";

describe("productDemoGeometry", () => {
  it("projects the default viewport into stable even-pixel browser geometry", () => {
    expect(
      productDemoGeometry({ width: 1440, height: 900 }, { width: 1920, height: 1080 }),
    ).toEqual({
      content: { x: 290, y: 145, width: 1340, height: 838 },
      browser: { x: 290, y: 97, width: 1340, height: 886 },
    });
  });
});
