import type { Locator, Page } from "playwright";
import {
  type ExploredInteractiveElementV2,
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
  let name: string | undefined;
  if (rawName !== undefined) {
    try {
      name = JSON.parse(`"${rawName}"`) as string;
    } catch {
      name = rawName;
    }
  }
  return { ...(role ? { role } : {}), ...(name ? { name } : {}) };
}

function cssId(id: string): string {
  return `#${id.replaceAll(/([^A-Za-z0-9_-])/g, "\\$1")}`;
}

function implicitRole(tagName: string, inputType?: string): string | undefined {
  if (tagName === "BUTTON") return "button";
  if (tagName === "A") return "link";
  if (tagName === "SELECT") return "combobox";
  if (tagName === "TEXTAREA") return "textbox";
  if (tagName !== "INPUT") return undefined;
  if (["checkbox", "radio", "button", "submit", "reset"].includes(inputType ?? ""))
    return inputType === "submit" || inputType === "reset" ? "button" : inputType;
  return "textbox";
}

export type ExplorationRefEntry = {
  locator: Locator;
  element: ExploredInteractiveElementV2;
};

export async function collectInteractiveTargets(
  page: Page,
  baseUrl: string,
): Promise<{
  elements: ExploredInteractiveElementV2[];
  refs: Map<string, ExplorationRefEntry>;
}> {
  const all = page.locator(interactiveSelector);
  const count = Math.min(await all.count(), 200);
  const elements: ExploredInteractiveElementV2[] = [];
  const refs = new Map<string, ExplorationRefEntry>();
  const baseOrigin = new URL(baseUrl).origin;

  for (let index = 0; index < count; index += 1) {
    const locator = all.nth(index);
    if (!(await locator.isVisible().catch(() => false))) continue;
    const bounds = await locator.boundingBox().catch(() => null);
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) continue;
    const facts = await locator
      .evaluate((node) => {
        const element = node as HTMLElement;
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
          inputType:
            element instanceof HTMLInputElement
              ? element.type
              : element instanceof HTMLButtonElement && element.form
                ? element.type
                : undefined,
          selected: element.getAttribute("aria-selected"),
          checked: element.getAttribute("aria-checked"),
          pressed: element.getAttribute("aria-pressed"),
          expanded: element.getAttribute("aria-expanded"),
        };
      })
      .catch(() => undefined);
    if (!facts) continue;
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
    ).slice(0, 300);
    const candidates: ExplorationTargetRecipe["candidates"] = [];
    if (role && name) candidates.push({ by: "role", role, name, exact: true });
    else if (role) candidates.push({ by: "role", role });
    if (facts.testId) candidates.push({ by: "test-id", testId: facts.testId });
    if (facts.id) candidates.push({ by: "css", selector: cssId(facts.id) });
    if (name) candidates.push({ by: "text", text: name, exact: true });
    if (candidates.length === 0) continue;
    let expectedCount: number | undefined;
    const primary = candidates[0];
    if (primary?.by === "role") {
      expectedCount = await page
        .getByRole(
          primary.role as Parameters<Page["getByRole"]>[0],
          primary.name ? { name: primary.name, exact: primary.exact ?? true } : {},
        )
        .count()
        .catch(() => undefined);
    } else if (primary?.by === "test-id") {
      expectedCount = await page
        .getByTestId(primary.testId)
        .count()
        .catch(() => undefined);
    } else if (primary?.by === "css") {
      expectedCount = await page
        .locator(primary.selector)
        .count()
        .catch(() => undefined);
    } else if (primary?.by === "text") {
      expectedCount = await page
        .getByText(primary.text, { exact: primary.exact ?? true })
        .count()
        .catch(() => undefined);
    }
    const expanded =
      facts.expanded === null || facts.expanded === undefined
        ? undefined
        : facts.expanded === "true";
    const risk = classifyExplorationElementRisk({
      ...(role ? { role } : {}),
      name,
      tagName: facts.tagName,
      ...(facts.inputType ? { inputType: facts.inputType } : {}),
      ...(facts.href ? { href: facts.href } : {}),
      ...(expanded === undefined ? {} : { expanded }),
      baseOrigin,
    });
    const ref = `e${elements.length + 1}`;
    const target: ExplorationTargetRecipe = {
      description: `${role ?? facts.tagName.toLowerCase()}${name ? ` "${name}"` : ""}`,
      candidates: candidates.slice(0, 5),
      expected: {
        ...(role ? { role } : {}),
        ...(name ? { accessibleName: name } : {}),
        ...(expectedCount === undefined ? {} : { count: expectedCount }),
      },
    };
    const element: ExploredInteractiveElementV2 = {
      ref,
      ...(role ? { role } : {}),
      name,
      tagName: facts.tagName,
      ...(facts.href ? { href: sanitizeExplorationUrl(facts.href) } : {}),
      ...(facts.inputType ? { inputType: facts.inputType } : {}),
      visible: true,
      enabled: await locator.isEnabled().catch(() => false),
      ...(facts.selected === null || facts.selected === undefined
        ? {}
        : { selected: facts.selected === "true" }),
      ...(facts.checked === null || facts.checked === undefined
        ? {}
        : { checked: facts.checked === "true" }),
      ...(facts.pressed === null || facts.pressed === undefined
        ? {}
        : { pressed: facts.pressed === "true" }),
      ...(expanded === undefined ? {} : { expanded }),
      bounds,
      risk: risk.risk,
      riskReasons: risk.reasons,
      target,
    };
    elements.push(element);
    refs.set(ref, { locator, element });
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
  const current = await entry.locator
    .evaluate((node) => {
      const element = node as HTMLElement;
      return {
        tagName: element.tagName,
        role: element.getAttribute("role") ?? undefined,
        ariaLabel: element.getAttribute("aria-label") ?? undefined,
        title: element.getAttribute("title") ?? undefined,
        placeholder: element.getAttribute("placeholder") ?? undefined,
        text: element.textContent?.trim().replace(/\s+/g, " ").slice(0, 300) ?? "",
        href: element instanceof HTMLAnchorElement ? element.href : undefined,
        inputType:
          element instanceof HTMLInputElement
            ? element.type
            : element instanceof HTMLButtonElement && element.form
              ? element.type
              : undefined,
        expanded: element.getAttribute("aria-expanded"),
      };
    })
    .catch(() => undefined);
  if (!current)
    throw new Error(`Element ${entry.element.ref} is detached; request a new observation`);
  const aria = await entry.locator
    .ariaSnapshot({ mode: "default", depth: 1, timeout: 2_000 })
    .then(parseAriaRoot)
    .catch((): { role?: string; name?: string } => ({}));
  const role = aria.role ?? current.role ?? implicitRole(current.tagName, current.inputType);
  const name = (
    aria.name ??
    current.ariaLabel ??
    current.title ??
    current.placeholder ??
    current.text
  ).slice(0, 300);
  if (
    role !== entry.element.role ||
    name !== entry.element.name ||
    current.tagName !== entry.element.tagName
  )
    throw new Error(
      `Element ${entry.element.ref} changed since ${observationId}; request a new observation`,
    );
  const expanded =
    current.expanded === null || current.expanded === undefined
      ? undefined
      : current.expanded === "true";
  const risk = classifyExplorationElementRisk({
    ...(role ? { role } : {}),
    name,
    tagName: current.tagName,
    ...(current.inputType ? { inputType: current.inputType } : {}),
    ...(current.href ? { href: current.href } : {}),
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
