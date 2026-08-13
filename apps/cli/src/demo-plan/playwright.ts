import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { DemoAction, DemoPlan, LocatorSpec } from "./plan.js";
import { parseDemoPlan } from "./plan.js";

type Node = {
  type: string;
  loc?: { start: { line: number; column: number } };
  [key: string]: unknown;
};
type Diagnostic = { line: number; message: string };
type Value = string | number | boolean;
type Environment = { values: Map<string, Value>; locators: Map<string, LocatorSpec> };

export type PlaywrightImportResult = {
  tests: string[];
  selectedTest?: string;
  plan?: DemoPlan;
  diagnostics: Diagnostic[];
};

type BabelBundle = { babelParse(code: string, filename: string, isModule: boolean): Node };

function node(value: unknown): Node | undefined {
  return value && typeof value === "object" && "type" in value ? (value as Node) : undefined;
}

function line(value: Node): number {
  return value.loc?.start.line ?? 1;
}

function memberName(value: Node | undefined): string | undefined {
  if (!value || value.type !== "MemberExpression" || value.computed) return undefined;
  const property = node(value.property);
  return property?.type === "Identifier" ? (property.name as string) : undefined;
}

function identifierName(value: Node | undefined): string | undefined {
  return value?.type === "Identifier" ? (value.name as string) : undefined;
}

function call(value: unknown): Node | undefined {
  const candidate = node(value);
  return candidate?.type === "CallExpression" ? candidate : undefined;
}

function argumentsOf(value: Node): Node[] {
  return ((value.arguments as unknown[]) ?? [])
    .map(node)
    .filter((item): item is Node => Boolean(item));
}

function literal(value: Node | undefined, environment: Environment): Value | undefined {
  if (!value) return undefined;
  if (["StringLiteral", "NumericLiteral", "BooleanLiteral"].includes(value.type))
    return value.value as Value;
  const name = identifierName(value);
  return name ? environment.values.get(name) : undefined;
}

function objectOptions(value: Node | undefined, environment: Environment): Map<string, Value> {
  const result = new Map<string, Value>();
  if (value?.type !== "ObjectExpression") return result;
  for (const propertyValue of (value.properties as unknown[]) ?? []) {
    const property = node(propertyValue);
    if (property?.type !== "ObjectProperty" || property.computed) continue;
    const keyNode = node(property.key);
    const key =
      identifierName(keyNode) ??
      (keyNode?.type === "StringLiteral" ? String(keyNode.value) : undefined);
    const parsed = literal(node(property.value), environment);
    if (key && parsed !== undefined) result.set(key, parsed);
  }
  return result;
}

function locatorFrom(value: Node | undefined, environment: Environment): LocatorSpec | undefined {
  const variable = identifierName(value);
  if (variable) return environment.locators.get(variable);
  const expression = call(value);
  if (!expression) return undefined;
  const callee = node(expression.callee);
  const method = memberName(callee);
  const receiver = node(callee?.object);
  if (identifierName(receiver) !== "page") return undefined;
  const args = argumentsOf(expression);
  const first = literal(args[0], environment);
  if (typeof first !== "string") return undefined;
  const options = objectOptions(args[1], environment);
  const exact =
    typeof options.get("exact") === "boolean" ? (options.get("exact") as boolean) : undefined;
  const withExact = exact === undefined ? {} : { exact };
  if (method === "getByRole") {
    const name = options.get("name");
    return {
      primary: {
        by: "role",
        role: first,
        ...(typeof name === "string" ? { name } : {}),
        ...withExact,
      },
    };
  }
  if (method === "getByText") return { primary: { by: "text", text: first, ...withExact } };
  if (method === "getByLabel") return { primary: { by: "label", label: first, ...withExact } };
  if (method === "getByPlaceholder")
    return { primary: { by: "placeholder", placeholder: first, ...withExact } };
  if (method === "getByTestId") return { primary: { by: "test-id", testId: first } };
  if (method === "locator") return { primary: { by: "css", selector: first } };
  return undefined;
}

function functionBody(value: Node | undefined): Node[] | undefined {
  if (!value || !["ArrowFunctionExpression", "FunctionExpression"].includes(value.type))
    return undefined;
  const body = node(value.body);
  return body?.type === "BlockStatement"
    ? ((body.body as unknown[]) ?? []).map(node).filter((item): item is Node => Boolean(item))
    : undefined;
}

function unwrapAwait(value: Node | undefined): Node | undefined {
  return value?.type === "AwaitExpression" ? node(value.argument) : value;
}

function diagnostic(diagnostics: Diagnostic[], source: Node, message: string): void {
  diagnostics.push({ line: line(source), message });
}

function interpretCall(
  expression: Node,
  environment: Environment,
  steps: DemoAction[],
  diagnostics: Diagnostic[],
): boolean {
  const callee = node(expression.callee);
  const method = memberName(callee);
  const receiver = node(callee?.object);
  const args = argumentsOf(expression);

  if (method === "step" && identifierName(receiver) === "test") {
    const body = functionBody(args[1]);
    if (!body) diagnostic(diagnostics, expression, "test.step must use an inline function");
    else interpretStatements(body, environment, steps, diagnostics);
    return true;
  }

  if (["toBeVisible", "toHaveURL"].includes(method ?? "")) {
    const expectCall = call(receiver);
    if (identifierName(node(expectCall?.callee)) !== "expect") return false;
    const subject = argumentsOf(expectCall!)[0];
    if (method === "toHaveURL" && identifierName(subject) === "page") {
      const pattern = literal(args[0], environment);
      if (typeof pattern !== "string")
        diagnostic(diagnostics, expression, "URL assertion must use a string literal");
      else {
        const timeout = objectOptions(args[1], environment).get("timeout");
        steps.push({
          type: "wait-for-url",
          urlPattern: pattern,
          ...(typeof timeout === "number" ? { timeoutMs: timeout } : {}),
        });
      }
      return true;
    }
    const locator = locatorFrom(subject, environment);
    if (!locator)
      diagnostic(diagnostics, expression, "Visible assertion uses an unsupported locator");
    else {
      const options = objectOptions(args[0], environment);
      const timeout = options.get("timeout");
      steps.push({
        type: "assert-visible",
        locator,
        ...(typeof timeout === "number" ? { timeoutMs: timeout } : {}),
      });
    }
    return true;
  }

  if (identifierName(receiver) === "page") {
    const first = literal(args[0], environment);
    if (method === "goto") {
      if (typeof first !== "string")
        diagnostic(diagnostics, expression, "page.goto must use a string literal");
      else steps.push({ type: "navigate", url: first });
      return true;
    }
    if (method === "waitForTimeout") {
      if (typeof first !== "number")
        diagnostic(diagnostics, expression, "waitForTimeout must use a numeric literal");
      else steps.push({ type: "hold", durationMs: first });
      return true;
    }
    if (method === "waitForURL") {
      if (typeof first !== "string")
        diagnostic(diagnostics, expression, "waitForURL must use a string literal");
      else {
        const timeout = objectOptions(args[1], environment).get("timeout");
        steps.push({
          type: "wait-for-url",
          urlPattern: first,
          ...(typeof timeout === "number" ? { timeoutMs: timeout } : {}),
        });
      }
      return true;
    }
  }

  if (method === "wheel" && memberName(receiver) === "mouse") {
    const pageReceiver = node(receiver?.object);
    const deltaX = literal(args[0], environment);
    const deltaY = literal(args[1], environment);
    if (
      identifierName(pageReceiver) !== "page" ||
      typeof deltaX !== "number" ||
      typeof deltaY !== "number"
    )
      diagnostic(diagnostics, expression, "mouse.wheel must use numeric literals");
    else steps.push({ type: "scroll", deltaX, deltaY });
    return true;
  }

  const locator = locatorFrom(receiver, environment);
  if (!locator) return false;
  const first = literal(args[0], environment);
  if (method === "click") {
    const button = objectOptions(args[0], environment).get("button");
    steps.push({
      type: "click",
      locator,
      ...(button === "left" || button === "middle" || button === "right" ? { button } : {}),
    });
    return true;
  }
  if (method === "hover") {
    steps.push({ type: "move", locator });
    return true;
  }
  if (method === "fill" && typeof first === "string")
    steps.push({ type: "fill", locator, value: first });
  else if (method === "press" && typeof first === "string")
    steps.push({ type: "press", locator, key: first });
  else if (method === "selectOption" && typeof first === "string")
    steps.push({ type: "select", locator, value: first });
  else if (method === "waitFor") {
    const options = objectOptions(args[0], environment);
    const state = options.get("state");
    const timeout = options.get("timeout");
    if (state !== undefined && state !== "visible")
      diagnostic(diagnostics, expression, "Only waitFor({ state: 'visible' }) is supported");
    else
      steps.push({
        type: "wait-for",
        locator,
        ...(typeof timeout === "number" ? { timeoutMs: timeout } : {}),
      });
  } else return false;
  return true;
}

function interpretStatements(
  statements: Node[],
  parentEnvironment: Environment,
  steps: DemoAction[],
  diagnostics: Diagnostic[],
): void {
  const environment: Environment = {
    values: new Map(parentEnvironment.values),
    locators: new Map(parentEnvironment.locators),
  };
  for (const statement of statements) {
    if (statement.type === "VariableDeclaration") {
      for (const declarationValue of (statement.declarations as unknown[]) ?? []) {
        const declaration = node(declarationValue);
        const name = identifierName(node(declaration?.id));
        const initial = node(declaration?.init);
        if (!declaration || !name || !initial) continue;
        const parsedValue = literal(initial, environment);
        const locator = locatorFrom(initial, environment);
        if (parsedValue !== undefined) environment.values.set(name, parsedValue);
        else if (locator) environment.locators.set(name, locator);
        else diagnostic(diagnostics, declaration, `Unsupported variable '${name}' in test flow`);
      }
      continue;
    }
    if (statement.type === "ExpressionStatement") {
      const expression = unwrapAwait(node(statement.expression));
      const expressionCall = call(expression);
      if (!expressionCall || !interpretCall(expressionCall, environment, steps, diagnostics))
        diagnostic(diagnostics, statement, "Unsupported statement in test flow");
      continue;
    }
    diagnostic(diagnostics, statement, `Unsupported ${statement.type} in test flow`);
  }
}

type FoundTest = { title: string; body: Node[]; hooks: Node[][] };

function collectTests(
  statements: Node[],
  titles: string[] = [],
  inheritedHooks: Node[][] = [],
): FoundTest[] {
  const tests: FoundTest[] = [];
  const hooks = [...inheritedHooks];
  for (const statement of statements) {
    if (statement.type !== "ExpressionStatement") continue;
    const expression = call(node(statement.expression));
    if (!expression) continue;
    const callee = node(expression.callee);
    const method = memberName(callee);
    const receiver = node(callee?.object);
    const args = argumentsOf(expression);
    if (identifierName(receiver) === "test" && method === "beforeEach") {
      const body = functionBody(args[0]);
      if (body) hooks.push(body);
      continue;
    }
    if (identifierName(receiver) === "test" && method === "describe") {
      const title = literal(args[0], { values: new Map(), locators: new Map() });
      const body = functionBody(args[1]);
      if (typeof title === "string" && body)
        tests.push(...collectTests(body, [...titles, title], hooks));
      continue;
    }
    const isTest =
      identifierName(callee) === "test" ||
      (identifierName(receiver) === "test" && ["only", "skip"].includes(method ?? ""));
    if (!isTest) continue;
    const title = literal(args[0], { values: new Map(), locators: new Map() });
    const body = functionBody(args[1]);
    if (typeof title === "string" && body)
      tests.push({ title: [...titles, title].join(" "), body, hooks: [...hooks] });
  }
  return tests;
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "playwright-demo"
  );
}

export async function importPlaywrightTest(options: {
  path: string;
  test?: string;
  baseUrl: string;
  name?: string;
  goal?: string;
  allowModifyData?: boolean;
  allowSubmitForms?: boolean;
  allowCrossOrigin?: boolean;
}): Promise<PlaywrightImportResult> {
  const source = await readFile(options.path, "utf8");
  // Reuse the TypeScript-capable parser shipped with our pinned Playwright runtime.
  const require = createRequire(import.meta.url);
  const parser = require("playwright/lib/transform/babelBundle") as BabelBundle;
  const ast = parser.babelParse(source, options.path, true);
  const program = node(ast.program);
  const statements = ((program?.body as unknown[]) ?? [])
    .map(node)
    .filter((item): item is Node => Boolean(item));
  const found = collectTests(statements);
  const tests = found.map((item) => item.title);
  const selected = options.test
    ? found.find((item) => item.title === options.test)
    : found.length === 1
      ? found[0]
      : undefined;
  if (!selected) {
    return {
      tests,
      diagnostics: [
        {
          line: 1,
          message: options.test ? `Test not found: ${options.test}` : "Select one test with --test",
        },
      ],
    };
  }
  const steps: DemoAction[] = [];
  const diagnostics: Diagnostic[] = [];
  const environment: Environment = { values: new Map(), locators: new Map() };
  for (const hook of selected.hooks) interpretStatements(hook, environment, steps, diagnostics);
  interpretStatements(selected.body, environment, steps, diagnostics);
  if (steps[0]?.type !== "navigate")
    diagnostics.push({ line: 1, message: "Imported flow must begin with page.goto()" });
  if (steps.some((step, index) => step.type === "navigate" && index > 0))
    diagnostics.push({
      line: 1,
      message: "Imported flow contains mid-story page.goto(); use a visible click instead",
    });
  if (diagnostics.length > 0) return { tests, selectedTest: selected.title, diagnostics };

  try {
    const plan = parseDemoPlan({
      version: 1,
      name: options.name ?? slug(selected.title),
      brief: {
        goal: options.goal ?? `Demonstrate ${selected.title}`,
        constraints: {
          submitForms: options.allowSubmitForms ?? false,
          modifyData: options.allowModifyData ?? false,
          sameOriginOnly: !(options.allowCrossOrigin ?? false),
        },
      },
      target: { baseUrl: options.baseUrl },
      capture: { steps },
      presentation: { beats: [] },
    });
    return { tests, selectedTest: selected.title, plan, diagnostics };
  } catch (error) {
    return {
      tests,
      selectedTest: selected.title,
      diagnostics: [{ line: 1, message: error instanceof Error ? error.message : String(error) }],
    };
  }
}

function locatorCode(locator: LocatorSpec): string {
  const method = locator.primary;
  if (method.by === "role") {
    const options = [
      method.name === undefined ? undefined : `name: ${JSON.stringify(method.name)}`,
      method.exact === undefined ? undefined : `exact: ${method.exact}`,
    ].filter(Boolean);
    return `page.getByRole(${JSON.stringify(method.role)}${options.length ? `, { ${options.join(", ")} }` : ""})`;
  }
  if (method.by === "text")
    return `page.getByText(${JSON.stringify(method.text)}${method.exact === undefined ? "" : `, { exact: ${method.exact} }`})`;
  if (method.by === "label")
    return `page.getByLabel(${JSON.stringify(method.label)}${method.exact === undefined ? "" : `, { exact: ${method.exact} }`})`;
  if (method.by === "placeholder")
    return `page.getByPlaceholder(${JSON.stringify(method.placeholder)}${method.exact === undefined ? "" : `, { exact: ${method.exact} }`})`;
  if (method.by === "test-id") return `page.getByTestId(${JSON.stringify(method.testId)})`;
  return `page.locator(${JSON.stringify(method.selector)})`;
}

export function exportDemoPlanToPlaywright(
  plan: DemoPlan,
  options: { importSource?: string; preserveHolds?: boolean } = {},
): { source: string; warnings: string[] } {
  const warnings: string[] = [];
  const viewport = plan.capture.viewport ?? { width: 1440, height: 900 };
  const lines = [
    `import { expect, test } from ${JSON.stringify(options.importSource ?? "@playwright/test")};`,
    "",
    `test.use({ baseURL: ${JSON.stringify(plan.target.baseUrl)}, viewport: { width: ${viewport.width}, height: ${viewport.height} } });`,
    "",
    `test(${JSON.stringify(plan.brief.goal)}, async ({ page }) => {`,
  ];
  for (const step of plan.capture.steps) {
    if (step.purpose) lines.push(`  // ${step.purpose.replaceAll("\n", " ")}`);
    if (step.type === "navigate") lines.push(`  await page.goto(${JSON.stringify(step.url)});`);
    else if (step.type === "scroll")
      lines.push(`  await page.mouse.wheel(${step.deltaX ?? 0}, ${step.deltaY});`);
    else if (step.type === "hold") {
      if (options.preserveHolds) lines.push(`  await page.waitForTimeout(${step.durationMs});`);
      else if (!warnings.includes("Editorial hold steps were omitted"))
        warnings.push("Editorial hold steps were omitted");
    } else if (step.type === "wait-for-url")
      lines.push(
        `  await page.waitForURL(${JSON.stringify(step.urlPattern)}${step.timeoutMs ? `, { timeout: ${step.timeoutMs} }` : ""});`,
      );
    else {
      const target = locatorCode(step.locator);
      if (step.locator.fallbacks?.length && !warnings.includes("Locator fallbacks were omitted"))
        warnings.push("Locator fallbacks were omitted");
      if (step.type === "move") lines.push(`  await ${target}.hover();`);
      else if (step.type === "click")
        lines.push(
          `  await ${target}.click(${step.button ? `{ button: ${JSON.stringify(step.button)} }` : ""});`,
        );
      else if (step.type === "fill")
        lines.push(`  await ${target}.fill(${JSON.stringify(step.value)});`);
      else if (step.type === "press")
        lines.push(`  await ${target}.press(${JSON.stringify(step.key)});`);
      else if (step.type === "select")
        lines.push(`  await ${target}.selectOption(${JSON.stringify(step.value)});`);
      else if (step.type === "wait-for")
        lines.push(
          `  await ${target}.waitFor({ state: "visible"${step.timeoutMs ? `, timeout: ${step.timeoutMs}` : ""} });`,
        );
      else if (step.type === "assert-visible")
        lines.push(
          `  await expect(${target}).toBeVisible(${step.timeoutMs ? `{ timeout: ${step.timeoutMs} }` : ""});`,
        );
    }
  }
  lines.push("});", "");
  if (plan.target.authProfile) warnings.push("The plan auth profile was not exported");
  if (plan.target.startCommand) warnings.push("The managed start command was not exported");
  return { source: lines.join("\n"), warnings };
}
