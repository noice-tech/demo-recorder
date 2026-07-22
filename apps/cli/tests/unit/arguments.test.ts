import { describe, expect, it } from "vitest";
import { parseArguments, stringOption } from "../../src/arguments.js";
import { commandOptions } from "../../src/index.js";

const definitions = {
  headed: { type: "boolean" as const },
  plan: { type: "string" as const },
  "contact-sheet": { type: "string" as const, optionalValue: true },
};

function definitionsFor(command: string) {
  const options = commandOptions[command];
  if (!options) throw new Error(`Missing test command options: ${command}`);
  return options;
}

describe("CLI argument parsing", () => {
  it("does not consume a positional after a boolean option", () => {
    const parsed = parseArguments(["--headed", "demo-plan.json"], definitions);
    expect(parsed.positionals).toEqual(["demo-plan.json"]);
    expect(parsed.options.get("headed")).toBe(true);
  });

  it("parses string options in separated and equals forms", () => {
    expect(stringOption(parseArguments(["--plan", "one.json"], definitions), "plan")).toBe(
      "one.json",
    );
    expect(stringOption(parseArguments(["--plan=two.json"], definitions), "plan")).toBe("two.json");
  });

  it("supports a bare optional-value flag without consuming a positional", () => {
    const parsed = parseArguments(["--contact-sheet", "video.mp4"], definitions);
    expect(parsed.positionals).toEqual(["video.mp4"]);
    expect(parsed.options.get("contact-sheet")).toBe(true);
  });

  it("accepts an optional value through equals syntax", () => {
    const parsed = parseArguments(
      ["video.mp4", "--contact-sheet=output/contact-sheet.png"],
      definitions,
    );
    expect(parsed.positionals).toEqual(["video.mp4"]);
    expect(stringOption(parsed, "contact-sheet")).toBe("output/contact-sheet.png");
  });

  it("keeps every public boolean option separate from positionals", () => {
    const cases = [
      { command: "doctor", option: "json" },
      { command: "setup", option: "json" },
      { command: "explore", option: "headed" },
      { command: "explore", option: "allow-cross-origin" },
      { command: "record", option: "headed" },
      { command: "run", option: "headed" },
    ];
    for (const { command, option } of cases) {
      const parsed = parseArguments([`--${option}`, "positional"], definitionsFor(command));
      expect(parsed.options.get(option)).toBe(true);
      expect(parsed.positionals).toEqual(["positional"]);
    }
  });

  it("defines strict options for every public command", () => {
    for (const command of [
      "doctor",
      "setup",
      "explore",
      "inspect-repo",
      "inspect",
      "plan",
      "auth",
      "record",
      "run",
      "render",
      "create",
    ]) {
      expect(() => parseArguments(["--unknown"], definitionsFor(command))).toThrow(
        "Unknown option",
      );
    }
  });

  it("rejects duplicate options", () => {
    expect(() => parseArguments(["--headed", "--headed"], definitions)).toThrow(
      "may only be specified once",
    );
  });
});
