import { parseArgs } from "node:util";

export type ParsedArguments = {
  positionals: string[];
  options: Map<string, string | true>;
};

export type OptionDefinition = {
  type: "boolean" | "string";
  optionalValue?: boolean;
};

export type OptionDefinitions = Record<string, OptionDefinition>;

function normalizedArguments(arguments_: string[], definitions: OptionDefinitions): string[] {
  return arguments_.map((argument) => {
    if (!argument.startsWith("--") || argument.includes("=")) return argument;
    const definition = definitions[argument.slice(2)];
    return definition?.type === "string" && definition.optionalValue ? `${argument}=` : argument;
  });
}

export function parseArguments(
  arguments_: string[],
  definitions: OptionDefinitions = {},
): ParsedArguments {
  const nodeOptions: Record<string, { type: "boolean" } | { type: "string" }> = {};
  for (const [name, definition] of Object.entries(definitions)) {
    nodeOptions[name] = { type: definition.type };
  }

  const parsed = parseArgs({
    args: normalizedArguments(arguments_, definitions),
    options: nodeOptions,
    allowPositionals: true,
    strict: true,
    tokens: true,
  });
  const seen = new Set<string>();
  for (const token of parsed.tokens) {
    if (token.kind !== "option") continue;
    if (seen.has(token.name)) throw new Error(`Option --${token.name} may only be specified once`);
    seen.add(token.name);
  }

  const options = new Map<string, string | true>();
  for (const [name, value] of Object.entries(parsed.values)) {
    if (value === undefined) continue;
    const definition = definitions[name];
    if (typeof value === "boolean") {
      if (value) options.set(name, true);
      continue;
    }
    options.set(name, value === "" && definition?.optionalValue ? true : value);
  }
  return { positionals: parsed.positionals, options };
}

export function stringOption(arguments_: ParsedArguments, name: string): string | undefined {
  const value = arguments_.options.get(name);
  return typeof value === "string" ? value : undefined;
}

export function dimensionsOption(
  arguments_: ParsedArguments,
  name: string,
): { width: number; height: number } | undefined {
  const text = stringOption(arguments_, name);
  if (text === undefined) return undefined;
  const match = /^(\d+)x(\d+)$/.exec(text);
  if (!match) throw new Error(`--${name} must use WIDTHxHEIGHT`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0)
    throw new Error(`--${name} dimensions must be positive integers`);
  return { width, height };
}

export function nonNegativeNumberOption(
  arguments_: ParsedArguments,
  name: string,
): number | undefined {
  const text = stringOption(arguments_, name);
  if (text === undefined) return undefined;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`--${name} must be a non-negative integer`);
  return value;
}

export function numberOption(arguments_: ParsedArguments, name: string, fallback: number): number {
  const text = stringOption(arguments_, name);
  if (text === undefined) return fallback;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`--${name} must be a positive integer`);
  return value;
}
