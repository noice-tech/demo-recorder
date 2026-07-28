import type { Locator, Page } from "playwright";
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
const accessibleIdentityConcurrency = 8;

type TargetFacts = {
  index: number;
  tagName: string;
  id: string;
  role: string | undefined;
  accessibleName: string;
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
  visible: boolean;
  enabled: boolean;
  inViewport: boolean;
  bounds: { x: number; y: number; width: number; height: number };
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
function evaluateElementFacts(node: Element): Omit<TargetFacts, "index"> {
  const element = node as HTMLElement;
  const bounds = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  let inputType: string | undefined;
  if (element instanceof HTMLInputElement) inputType = element.type;
  else if (element instanceof HTMLButtonElement && element.form) inputType = element.type;

  const labelledBy = (element.getAttribute("aria-labelledby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();
  const labels =
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
      ? [...(element.labels ?? [])]
          .map((label) => label.textContent ?? "")
          .join(" ")
          .trim()
      : "";
  const value =
    element instanceof HTMLInputElement && ["button", "submit", "reset"].includes(element.type)
      ? element.value
      : "";
  const text = element.textContent?.trim().replace(/\s+/g, " ").slice(0, 300) ?? "";
  const accessibleName =
    [
      element.getAttribute("aria-label"),
      labelledBy,
      labels,
      element.getAttribute("alt"),
      element.getAttribute("title"),
      element.getAttribute("placeholder"),
      value,
      text,
    ]
      .find((candidate) => candidate?.trim())
      ?.trim()
      .replace(/\s+/g, " ")
      .slice(0, 300) ?? "";
  const visible =
    style.visibility !== "hidden" &&
    style.display !== "none" &&
    element.getClientRects().length > 0 &&
    bounds.width > 0 &&
    bounds.height > 0;
  const inViewport =
    visible &&
    bounds.left < window.innerWidth &&
    bounds.right > 0 &&
    bounds.top < window.innerHeight &&
    bounds.bottom > 0;

  return {
    tagName: element.tagName,
    id: element.id,
    role: element.getAttribute("role") ?? undefined,
    accessibleName,
    ariaLabel: element.getAttribute("aria-label") ?? undefined,
    title: element.getAttribute("title") ?? undefined,
    placeholder: element.getAttribute("placeholder") ?? undefined,
    text,
    testId: element.getAttribute("data-testid") ?? undefined,
    href: element instanceof HTMLAnchorElement ? element.href : undefined,
    inputType,
    selected: element.getAttribute("aria-selected"),
    checked:
      element.getAttribute("aria-checked") ??
      (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)
        ? String(element.checked)
        : null),
    pressed: element.getAttribute("aria-pressed"),
    expanded: element.getAttribute("aria-expanded"),
    visible,
    enabled: !element.matches(":disabled") && element.getAttribute("aria-disabled") !== "true",
    inViewport,
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
  };
}

async function collectTargetFacts(page: Page): Promise<TargetFacts[]> {
  const all = page.locator(interactiveSelector);
  return all.evaluateAll(
    (nodes, limit) =>
      nodes.slice(0, limit).map((node, index) => {
        const element = node as HTMLElement;
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        let inputType: string | undefined;
        if (element instanceof HTMLInputElement) inputType = element.type;
        else if (element instanceof HTMLButtonElement && element.form) inputType = element.type;

        const labelledBy = (element.getAttribute("aria-labelledby") ?? "")
          .split(/\s+/)
          .filter(Boolean)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
          .trim();
        const labels =
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement
            ? [...(element.labels ?? [])]
                .map((label) => label.textContent ?? "")
                .join(" ")
                .trim()
            : "";
        const value =
          element instanceof HTMLInputElement &&
          ["button", "submit", "reset"].includes(element.type)
            ? element.value
            : "";
        const text = element.textContent?.trim().replace(/\s+/g, " ").slice(0, 300) ?? "";
        const accessibleName =
          [
            element.getAttribute("aria-label"),
            labelledBy,
            labels,
            element.getAttribute("alt"),
            element.getAttribute("title"),
            element.getAttribute("placeholder"),
            value,
            text,
          ]
            .find((candidate) => candidate?.trim())
            ?.trim()
            .replace(/\s+/g, " ")
            .slice(0, 300) ?? "";
        const visible =
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          element.getClientRects().length > 0 &&
          bounds.width > 0 &&
          bounds.height > 0;
        const inViewport =
          visible &&
          bounds.left < window.innerWidth &&
          bounds.right > 0 &&
          bounds.top < window.innerHeight &&
          bounds.bottom > 0;

        return {
          index,
          tagName: element.tagName,
          id: element.id,
          role: element.getAttribute("role") ?? undefined,
          accessibleName,
          ariaLabel: element.getAttribute("aria-label") ?? undefined,
          title: element.getAttribute("title") ?? undefined,
          placeholder: element.getAttribute("placeholder") ?? undefined,
          text,
          testId: element.getAttribute("data-testid") ?? undefined,
          href: element instanceof HTMLAnchorElement ? element.href : undefined,
          inputType,
          selected: element.getAttribute("aria-selected"),
          checked:
            element.getAttribute("aria-checked") ??
            (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)
              ? String(element.checked)
              : null),
          pressed: element.getAttribute("aria-pressed"),
          expanded: element.getAttribute("aria-expanded"),
          visible,
          enabled:
            !element.matches(":disabled") && element.getAttribute("aria-disabled") !== "true",
          inViewport,
          bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        };
      }),
    maximumTargets,
  );
}

async function readAccessibleIdentity(
  locator: Locator,
  facts: Omit<TargetFacts, "index">,
  useBrowserSnapshot = true,
): Promise<AccessibleIdentity> {
  const aria = useBrowserSnapshot
    ? await locator
        .ariaSnapshot({ mode: "default", depth: 1, timeout: 2_000 })
        .then(parseAriaRoot)
        .catch((): { role?: string; name?: string } => ({}))
    : {};
  const role = aria.role ?? facts.role ?? implicitRole(facts.tagName, facts.inputType);
  const name = (
    aria.name ??
    facts.accessibleName ??
    facts.ariaLabel ??
    facts.title ??
    facts.placeholder ??
    facts.text
  ).slice(0, maximumNameLength);
  return { ...(role ? { role } : {}), name };
}

function buildLocatorCandidates(
  facts: Omit<TargetFacts, "index">,
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

function ariaBoolean(value: string | null): boolean | undefined {
  return value === null ? undefined : value === "true";
}

async function inspectTarget(
  locator: Locator,
  facts: TargetFacts,
  ref: string,
  baseOrigin: string,
): Promise<ExplorationRefEntry | undefined> {
  if (!facts.visible) return undefined;
  const identity = await readAccessibleIdentity(locator, facts, facts.inViewport);
  const candidates = buildLocatorCandidates(facts, identity);
  if (candidates.length === 0) return undefined;

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
    enabled: facts.enabled,
    ...(selected === undefined ? {} : { selected }),
    ...(checked === undefined ? {} : { checked }),
    ...(pressed === undefined ? {} : { pressed }),
    ...(expanded === undefined ? {} : { expanded }),
    bounds: facts.bounds,
    risk: risk.risk,
    riskReasons: risk.reasons,
    target,
  };
  return { locator, element };
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  callback: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = Array.from({ length: values.length }, () => undefined as R);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (nextIndex < values.length) {
        const index = nextIndex++;
        results[index] = await callback(values[index]!, index);
      }
    }),
  );
  return results;
}

export async function collectInteractiveTargets(
  page: Page,
  baseUrl: string,
): Promise<{
  elements: ExploredInteractiveElementV2[];
  refs: Map<string, ExplorationRefEntry>;
}> {
  const all = page.locator(interactiveSelector);
  const visibleFacts = (await collectTargetFacts(page)).filter((target) => target.visible);
  const facts = [
    ...visibleFacts.filter((target) => target.inViewport),
    ...visibleFacts.filter((target) => !target.inViewport),
  ];
  const baseOrigin = new URL(baseUrl).origin;
  const inspected = await mapWithConcurrency(
    facts,
    accessibleIdentityConcurrency,
    (target, index) => inspectTarget(all.nth(target.index), target, `e${index + 1}`, baseOrigin),
  );
  const elements: ExploredInteractiveElementV2[] = [];
  const refs = new Map<string, ExplorationRefEntry>();
  for (const entry of inspected) {
    if (!entry) continue;
    elements.push(entry.element);
    refs.set(entry.element.ref, entry);
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
      enabled: facts.enabled,
      risk: risk.risk,
      riskReasons: risk.reasons,
    },
  };
}
