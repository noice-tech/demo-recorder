import { createRequire } from "node:module";
import { runProcess } from "@noice-tech/demo-recorder-renderer";
import { chromium } from "playwright";
import { booleanOption, type OptionDefinitions, type ParsedArguments } from "../support/args.js";

export const setupOptions: OptionDefinitions = {
  chromium: { type: "boolean" },
  "accept-downloads": { type: "boolean" },
};

export async function runSetup(args: ParsedArguments): Promise<unknown> {
  if (!booleanOption(args, "chromium")) {
    throw new Error("Pass --chromium to install the Playwright Chromium build");
  }
  if (!booleanOption(args, "accept-downloads")) {
    throw new Error("Pass --accept-downloads to confirm the browser download");
  }

  const require = createRequire(import.meta.url);
  const cli = require.resolve("playwright/cli.js");
  const result = await runProcess(process.execPath, [cli, "install", "chromium"]);
  const tail = result.stdout.trim().split("\n").slice(-5);
  return {
    installed: true,
    chromium: chromium.executablePath(),
    output: tail,
  };
}
