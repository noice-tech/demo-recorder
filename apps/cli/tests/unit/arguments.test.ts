import { describe, expect, it } from "vitest";
import {
  dimensionsOption,
  nonNegativeNumberOption,
  parseArguments,
  stringOption,
} from "../../src/support/args.js";

const definitions = {
  headed: { type: "boolean" as const },
  plan: { type: "string" as const },
  "contact-sheet": { type: "string" as const, optionalValue: true },
};

const renderDefinitions = {
  size: { type: "string" as const },
  padding: { type: "string" as const },
};

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

  it("parses output size and zero padding options", () => {
    const render = parseArguments(["--size", "1080x1080", "--padding", "0"], renderDefinitions);
    expect(dimensionsOption(render, "size")).toEqual({ width: 1080, height: 1080 });
    expect(nonNegativeNumberOption(render, "padding")).toBe(0);
  });

  it("rejects malformed dimensions", () => {
    const parsed = parseArguments(["--size", "wide"], renderDefinitions);
    expect(() => dimensionsOption(parsed, "size")).toThrow("WIDTHxHEIGHT");
  });

  it("rejects unknown options", () => {
    expect(() => parseArguments(["--unknown"], definitions)).toThrow("Unknown option");
  });

  it("rejects duplicate options", () => {
    expect(() => parseArguments(["--headed", "--headed"], definitions)).toThrow(
      "may only be specified once",
    );
  });
});
