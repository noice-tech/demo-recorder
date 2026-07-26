import type { Locator, Page } from "playwright";
import { locatorForMethod } from "../browser/locator.js";
import {
  type ExploredInteractiveElementV2,
  type ExplorationLocatorMethod,
  type ExplorationTargetRecipe,
} from "./interactive-schema.js";
import { classifyExplorationElementRisk } from "./interactive-policy.js";
import { sanitizeExplorationUrl } from "./privacy.js";

const interactiveSelector = [
  "a[href]",
  "button",
  'input:not([type="hidden"])',
  "textarea",
  "select",
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="link"]',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

const maximumTargets = 200;
const maximumNameLength = 300;

type TargetFacts = {
  tagName: string;
  id: string;
  role: string | undefined;
  ariaLabel: string | undefined;
  title: string | undefined;
  placeholder: string | undefined;
  text: string;
  testId: string | undefined;
  href: string | undefined;
  inputType: string | undefined;
  selected: string | null;
  checked: string | null;
  pressed: string | null;
  expanded: string | null;
};

type AccessibleIdentity = { role?: string; name: string };

export type ExplorationRefEntry = {
  locator: Locator;
  element: ExploredInteractiveElementV2;
};

function parseAriaRoot(snapshot: string): { role?: string; name?: string } {
  const firstLine = snapshot
    .split("\n")
    .find((line) => line.trim().startsWith("- "))
    ?.trim();
  if (!firstLine) return {};

  const match = /^- ([^\s:"]+)(?: "((?:[^"\\]|\\.)*)")?/.exec(firstLine);
  if (!match) return {};
  const role = match[1];
  const rawName = match[2];
  if (rawName === undefined) return role ? { role } : {};

  try {
    const name = JSON.parse(`"${rawName}"`) as string;
    return { ...(role ? { role } : {}), ...(name ? { name } : {}) };
  } catch {
    return { ...(role ? { role } : {}), ...(rawName ? { name: rawName } : {}) };
  }
}

function cssId(id: string): string {
  return /^-?[A-Za-z_][A-Za-z0-9_-]*$/.test(id) ? `#${id}` : `[id=${JSON.stringify(id)}]`;
}

function implicitRole(tagName: string, inputType?: string): string | undefined {
  switch (tagName) {
    case "BUTTON":
      return "button";
    case "A":
      return "link";
    case "SELECT":
      return "combobox";
    case "TEXTAREA":
      return "textbox";
    case "INPUT":
      if (inputType === "checkbox" || inputType === "radio") return inputType;
      if (["button", "submit", "reset"].includes(inputType ?? "")) return "button";
      return "textbox";
    default:
      return undefined;
  }
}

// This callback is serialized by Playwright and runs inside the page. Keep its return value
// deliberately small: observations should describe controls, not copy arbitrary page content.
function evaluateElementFacts(node: Element): TargetFacts {
  const element = node as HTMLElement;
  let inputType: string | undefined;
  if (element instanceof HTMLInputElement) inputType = element.type;
  else if (element instanceof HTMLButtonElement && element.form) inputType = element.type;

  return {
    tagName: element.tagName,
    id: element.id,
    role: element.getAttribute("role") ?? undefined,
    ariaLabel: element.getAttribute("aria-label") ?? undefined,
    title: element.getAttribute("title") ?? undefined,
    placeholder: element.getAttribute("placeholder") ?? undefined,
    text: element.textContent?.trim().replace(/\s+/g, " ").slice(0, 300) ?? "",
    testId: element.getAttribute("data-testid") ?? undefined,
    href: element instanceof HTMLAnchorElement ? element.href : undefined,
    inputType,
    selected: element.getAttribute("aria-selected"),
    checked: element.getAttribute("aria-checked"),
    pressed: element.getAttribute("aria-pressed"),
    expanded: element.getAttribute("aria-expanded"),
  };
}

async function readAccessibleIdentity(
  locator: Locator,
  facts: TargetFacts,
): Promise<AccessibleIdentity> {
  const aria = await locator
    .ariaSnapshot({ mode: "default", depth: 1, timeout: 2_000 })
    .then(parseAriaRoot)
    .catch((): { role?: string; name?: string } => ({}));
  const role = aria.role ?? facts.role ?? implicitRole(facts.tagName, facts.inputType);
  const name = (
    aria.name ??
    facts.ariaLabel ??
    facts.title ??
    facts.placeholder ??
    facts.text
  ).slice(0, maximumNameLength);
  return { ...(role ? { role } : {}), name };
}

function buildLocatorCandidates(
  facts: TargetFacts,
  identity: AccessibleIdentity,
): ExplorationLocatorMethod[] {
  const candidates: ExplorationLocatorMethod[] = [];
  if (identity.role && identity.name)
    candidates.push({ by: "role", role: identity.role, name: identity.name, exact: true });
  else if (identity.role) candidates.push({ by: "role", role: identity.role });
  if (facts.testId) candidates.push({ by: "test-id", testId: facts.testId });
  if (facts.id) candidates.push({ by: "css", selector: cssId(facts.id) });
  if (identity.name) candidates.push({ by: "text", text: identity.name, exact: true });
  return candidates.slice(0, 5);
}

async function expectedLocatorCount(
  page: Page,
  primary: ExplorationLocatorMethod | undefined,
): Promise<number | undefined> {
  if (!primary) return undefined;
  return locatorForMethod(page, primary)
    .count()
    .catch(() => undefined);
}

function ariaBoolean(value: string | null): boolean | undefined {
  return value === null ? undefined : value === "true";
}

async function inspectTarget(
  page: Page,
  locator: Locator,
  ref: string,
  baseOrigin: string,
): Promise<ExplorationRefEntry | undefined> {
  if (!(await locator.isVisible().catch(() => false))) return undefined;
  const bounds = await locator.boundingBox().catch(() => null);
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return undefined;

  const facts = await locator.evaluate(evaluateElementFacts).catch(() => undefined);
  if (!facts) return undefined;
  const identity = await readAccessibleIdentity(locator, facts);
  const candidates = buildLocatorCandidates(facts, identity);
  if (candidates.length === 0) return undefined;

  const expectedCount = await expectedLocatorCount(page, candidates[0]);
  const selected = ariaBoolean(facts.selected);
  const checked = ariaBoolean(facts.checked);
  const pressed = ariaBoolean(facts.pressed);
  const expanded = ariaBoolean(facts.expanded);
  const risk = classifyExplorationElementRisk({
    ...(identity.role ? { role: identity.role } : {}),
    name: identity.name,
    tagName: facts.tagName,
    ...(facts.inputType ? { inputType: facts.inputType } : {}),
    ...(facts.href ? { href: facts.href } : {}),
    ...(expanded === undefined ? {} : { expanded }),
    baseOrigin,
  });
  const target: ExplorationTargetRecipe = {
    description: `${identity.role ?? facts.tagName.toLowerCase()}${identity.name ? ` "${identity.name}"` : ""}`,
    candidates,
    expected: {
      ...(identity.role ? { role: identity.role } : {}),
      ...(identity.name ? { accessibleName: identity.name } : {}),
      ...(expectedCount === undefined ? {} : { count: expectedCount }),
    },
  };
  const element: ExploredInteractiveElementV2 = {
    ref,
    ...(identity.role ? { role: identity.role } : {}),
    name: identity.name,
    tagName: facts.tagName,
    ...(facts.href ? { href: sanitizeExplorationUrl(facts.href) } : {}),
    ...(facts.inputType ? { inputType: facts.inputType } : {}),
    visible: true,
    enabled: await locator.isEnabled().catch(() => false),
    ...(selected === undefined ? {} : { selected }),
    ...(checked === undefined ? {} : { checked }),
    ...(pressed === undefined ? {} : { pressed }),
    ...(expanded === undefined ? {} : { expanded }),
    bounds,
    risk: risk.risk,
    riskReasons: risk.reasons,
    target,
  };
  return { locator, element };
}

export async function collectInteractiveTargets(
  page: Page,
  baseUrl: string,
): Promise<{
  elements: ExploredInteractiveElementV2[];
  refs: Map<string, ExplorationRefEntry>;
}> {
  const all = page.locator(interactiveSelector);
  const count = Math.min(await all.count(), maximumTargets);
  const elements: ExploredInteractiveElementV2[] = [];
  const refs = new Map<string, ExplorationRefEntry>();
  const baseOrigin = new URL(baseUrl).origin;

  for (let index = 0; index < count; index += 1) {
    const ref = `e${elements.length + 1}`;
    const entry = await inspectTarget(page, all.nth(index), ref, baseOrigin);
    if (!entry) continue;
    elements.push(entry.element);
    refs.set(ref, entry);
  }
  return { elements, refs };
}

export async function refreshInteractiveTarget(
  entry: ExplorationRefEntry,
  baseUrl: string,
  observationId: string,
): Promise<ExplorationRefEntry> {
  if (!(await entry.locator.isVisible().catch(() => false)))
    throw new Error(`Element ${entry.element.ref} is no longer visible; request a new observation`);
  const facts = await entry.locator.evaluate(evaluateElementFacts).catch(() => undefined);
  if (!facts)
    throw new Error(`Element ${entry.element.ref} is detached; request a new observation`);

  // Refs are intentionally short-lived. Re-check identity before acting so a rerender cannot
  // silently redirect an approved action to a different control.
  const identity = await readAccessibleIdentity(entry.locator, facts);
  if (
    identity.role !== entry.element.role ||
    identity.name !== entry.element.name ||
    facts.tagName !== entry.element.tagName
  )
    throw new Error(
      `Element ${entry.element.ref} changed since ${observationId}; request a new observation`,
    );

  const expanded = ariaBoolean(facts.expanded);
  const risk = classifyExplorationElementRisk({
    ...(identity.role ? { role: identity.role } : {}),
    name: identity.name,
    tagName: facts.tagName,
    ...(facts.inputType ? { inputType: facts.inputType } : {}),
    ...(facts.href ? { href: facts.href } : {}),
    ...(expanded === undefined ? {} : { expanded }),
    baseOrigin: new URL(baseUrl).origin,
  });
  return {
    locator: entry.locator,
    element: {
      ...entry.element,
      enabled: await entry.locator.isEnabled().catch(() => false),
      risk: risk.risk,
      riskReasons: risk.reasons,
    },
  };
}
