import { describe, expect, it } from "vitest";
import { createProgressParser } from "../src/index.js";

describe("createProgressParser", () => {
  it("handles chunked machine-readable progress", () => {
    const values: Array<{ outTimeMs: number; progress?: string }> = [];
    const parse = createProgressParser((value) => values.push({ ...value }));
    parse("out_time_us=1500");
    parse("000\nprogress=continue\nout_time_us=3000000\nprogress=end\n");
    expect(values).toEqual([
      { outTimeMs: 1500, progress: "continue" },
      { outTimeMs: 3000, progress: "end" },
    ]);
  });
});
