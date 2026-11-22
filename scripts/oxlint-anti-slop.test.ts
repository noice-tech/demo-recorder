import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const cases: Record<string, { source: string; rules: string[] }> = {
  "vi-mock": {
    source: 'import { vi } from "vitest";\nvi.mock("x");',
    rules: ["no-module-mocking"],
  },
  "vi-computed": {
    source: 'import { vi } from "vitest";\nvi["doMock"]("x");',
    rules: ["no-module-mocking"],
  },
  "vi-alias": {
    source: 'import { vi as v } from "vitest";\nv.mock("x");',
    rules: ["no-module-mocking"],
  },
  "vitest-namespace": {
    source: 'import * as vitest from "vitest";\nvitest.vi.mock("x");',
    rules: ["no-module-mocking"],
  },
  "jest-set-mock": {
    source: 'import { jest } from "@jest/globals";\njest.setMock("x", {});',
    rules: ["no-module-mocking"],
  },
  "jest-global": { source: 'jest.mock("x");', rules: ["no-module-mocking"] },
  "vi-fn": { source: 'import { vi } from "vitest";\nvi.fn();', rules: [] },
  "local-vi": { source: 'const vi = { mock(_: string) {} };\nvi.mock("x");', rules: [] },
  "cast-unexplained": {
    source: "export const n = JSON.parse('1') as number;",
    rules: ["require-safety-comment-for-type-assertion"],
  },
  "cast-explained": {
    source: "// SAFETY: the literal is a number.\nexport const n = JSON.parse('1') as number;",
    rules: [],
  },
  "cast-widening": { source: "export const v = JSON.parse('1') as unknown;", rules: [] },
  "cast-chained": {
    source: "// SAFETY: test.\nexport const n = (1 as unknown) as string;",
    rules: ["no-chained-type-assertions"],
  },
};

describe("anti-slop lint rules", () => {
  it("flag module mocking and unexplained casts, and nothing else", async () => {
    const directory = await mkdtemp(join(tmpdir(), "anti-slop-"));
    const config = join(directory, ".oxlintrc.json");
    await writeFile(
      config,
      JSON.stringify({
        jsPlugins: [{ name: "anti-slop", specifier: resolve("scripts/oxlint-anti-slop.ts") }],
        rules: {
          "anti-slop/no-chained-type-assertions": "error",
          "anti-slop/require-safety-comment-for-type-assertion": "error",
          "anti-slop/no-module-mocking": "error",
        },
      }),
    );
    for (const [name, { source }] of Object.entries(cases)) {
      await writeFile(join(directory, `${name}.ts`), source);
    }

    const { stdout } = await promisify(execFile)(resolve("node_modules/.bin/oxlint"), [
      "-c",
      config,
      "-f",
      "json",
      directory,
    ]).catch((error: { stdout: string }) => error);
    // SAFETY: oxlint's JSON reporter prints this shape.
    const { diagnostics } = JSON.parse(stdout) as {
      diagnostics: Array<{ filename: string; code: string }>;
    };

    const found = new Map(Object.keys(cases).map((name): [string, string[]] => [name, []]));
    for (const { filename, code } of diagnostics) {
      const rule = /^anti-slop\((.*)\)$/.exec(code)?.[1];
      if (rule) {
        found.get(basename(filename, ".ts"))?.push(rule);
      }
    }
    expect(Object.fromEntries(found)).toEqual(
      Object.fromEntries(Object.entries(cases).map(([name, { rules }]) => [name, rules])),
    );
  });
});
