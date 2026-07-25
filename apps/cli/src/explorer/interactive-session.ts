import { createHash } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { installSessionStorage, loadSessionStorage } from "./session-storage.js";
import {
  explorationActionSchema,
  explorationFindQuerySchema,
  explorationFindResultSchema,
  explorationObservationSchema,
  explorationSessionReportSchema,
  explorationTransitionSchema,
  type ExploredInteractiveElementV2,
  type ExplorationAction,
  type ExplorationFindResult,
  type ExplorationLaunchConfig,
  type ExplorationObservation,
  type ExplorationSessionReport,
  type ExplorationTargetRecipe,
  type ExplorationTransition,
} from "./interactive-schema.js";

const viewport = { width: 1440, height: 900 };
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

const destructivePattern =
  /\b(delete|remove|erase|destroy|purchase|buy|pay|publish|send|invite|deploy|merge|revoke|reset|cancel subscription|place order|sign out|log out)\b/i;
const mutationPattern =
  /\b(create|add|upload|approve|launch|save|edit|rename|subscribe|follow|submit|sign up|create account|checkout)\b/i;
const externalEffectPattern =
  /\b(oauth|authorize|grant access|download|install|open in|continue to)\b/i;
const presentationalPattern =
  /\b(open|close|view|show|hide|expand|collapse|next|previous|back|menu|tab|details|preview|examples?|features?|templates?)\b/i;

function sanitizedUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return value.slice(0, 500);
  }
}

function sanitizedError(value: string): string {
  return value
    .replaceAll(/https?:\/\/[^\s)\]}>'"]+/g, (url) => sanitizedUrl(url))
    .replaceAll(/\s+/g, " ")
    .slice(0, 1_000);
}

function pathForArtifact(outputDirectory: string, absolutePath: string): string {
  return relative(outputDirectory, absolutePath).replaceAll("\\", "/");
}

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

function riskForElement(element: {
  role?: string;
  name: string;
  tagName: string;
  inputType?: string;
  href?: string;
  expanded?: boolean;
  baseOrigin: string;
}): { risk: ExploredInteractiveElementV2["risk"]; reasons: string[] } {
  const description = `${element.role ?? ""} ${element.name}`.trim();
  if (destructivePattern.test(description))
    return { risk: "destructive", reasons: ["Target text matches a destructive action"] };
  if (externalEffectPattern.test(description))
    return {
      risk: "external-side-effect",
      reasons: ["Target text suggests an external side effect"],
    };
  if (element.href) {
    const destination = new URL(element.href);
    if (destination.origin !== element.baseOrigin)
      return { risk: "external-side-effect", reasons: ["Link leaves the allowed origin"] };
    return { risk: "read-only", reasons: ["Same-origin link"] };
  }
  if (
    element.role === "tab" ||
    element.expanded !== undefined ||
    presentationalPattern.test(description)
  )
    return { risk: "read-only", reasons: ["Control appears presentational"] };
  if (mutationPattern.test(description))
    return { risk: "reversible", reasons: ["Target text suggests application data may change"] };
  if (["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) || element.inputType === "submit")
    return { risk: "unknown", reasons: ["Form controls are not safe by default"] };
  return {
    risk: "unknown",
    reasons: ["Runtime could not establish that this control is read-only"],
  };
}

type RefEntry = { locator: Locator; element: ExploredInteractiveElementV2 };
type Settled = ExplorationObservation["settled"];

export class InteractiveExplorationSession {
  private browser!: Browser;
  private context!: BrowserContext;
  private page!: Page;
  private createdAt = new Date().toISOString();
  private startedAtMs = Date.now();
  private observationSequence = 0;
  private transitionSequence = 0;
  private actionCount = 0;
  private stateSequence = 0;
  private currentObservation: ExplorationObservation | undefined;
  private refs = new Map<string, RefEntry>();
  private states = new Map<string, string>();
  private observations: ExplorationObservation[] = [];
  private transitions: ExplorationTransition[] = [];
  private errors: string[] = [];
  private popupBlocked = false;
  private downloadBlocked = false;
  private dialogDismissed = false;
  private closed = false;

  constructor(readonly config: ExplorationLaunchConfig) {}

  async start(): Promise<ExplorationObservation> {
    await Promise.all([
      mkdir(join(this.config.outputDirectory, "observations"), { recursive: true }),
      mkdir(join(this.config.outputDirectory, "snapshots"), { recursive: true }),
      mkdir(join(this.config.outputDirectory, "screenshots"), { recursive: true }),
      mkdir(join(this.config.outputDirectory, "diagnostics"), { recursive: true }),
    ]);
    this.browser = await chromium.launch({ headless: this.config.headless });
    this.context = await this.browser.newContext({
      viewport,
      acceptDownloads: false,
      ...(this.config.storageStatePath ? { storageState: this.config.storageStatePath } : {}),
    });
    if (this.config.sessionStoragePath) {
      await installSessionStorage(
        this.context,
        await loadSessionStorage(this.config.sessionStoragePath),
      );
    }
    const allowedOrigin = new URL(this.config.baseUrl).origin;
    await this.context.route("**/*", async (route) => {
      const request = route.request();
      if (
        request.isNavigationRequest() &&
        request.frame().parentFrame() === null &&
        /^https?:/.test(request.url()) &&
        new URL(request.url()).origin !== allowedOrigin
      ) {
        this.errors.push(
          `Blocked cross-origin main-frame navigation to ${sanitizedUrl(request.url())}`,
        );
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });
    await this.context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    this.page = await this.context.newPage();
    this.attachPageEvents(this.page);
    this.page.on("popup", (popup) => {
      this.popupBlocked = true;
      void popup.close().catch(() => undefined);
    });
    await this.page.goto(this.config.baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const settled = await this.waitForSemanticQuiet("initial");
    const observation = await this.observe("initial", settled);
    await this.writeReport("active");
    return observation;
  }

  private attachPageEvents(page: Page): void {
    page.on("console", (message) => {
      if (message.type() === "error")
        this.errors.push(sanitizedError(`console: ${message.text()}`));
    });
    page.on("pageerror", (error) => this.errors.push(sanitizedError(`page: ${error.message}`)));
    page.on("dialog", (dialog) => {
      this.dialogDismissed = true;
      void dialog.dismiss().catch(() => undefined);
    });
    page.on("download", (download) => {
      this.downloadBlocked = true;
      void download.cancel().catch(() => undefined);
    });
  }

  private ensureWithinLimits(): void {
    if (this.actionCount >= this.config.maxActions)
      throw new Error(`Exploration action limit reached (${this.config.maxActions})`);
    if (Date.now() - this.startedAtMs >= this.config.maxDurationMs)
      throw new Error(`Exploration duration limit reached (${this.config.maxDurationMs}ms)`);
  }

  private async waitForSemanticQuiet(initialReason?: "initial" | "explicit"): Promise<Settled> {
    if (initialReason === "explicit") return { reason: "explicit", durationMs: 0 };
    const startedAt = Date.now();
    let previous = "";
    let stableSince = Date.now();
    const timeoutMs = initialReason === "initial" ? 3_000 : 2_500;
    while (Date.now() - startedAt < timeoutMs) {
      await this.page.waitForTimeout(100);
      const snapshot = await this.page.ariaSnapshot({ mode: "default", depth: 8, timeout: 2_000 });
      const normalized = snapshot.replaceAll(/\s+/g, " ").trim();
      if (normalized === previous) {
        if (Date.now() - stableSince >= 250) {
          return {
            reason: initialReason === "initial" ? "initial" : "quiet",
            durationMs: Date.now() - startedAt,
          };
        }
      } else {
        previous = normalized;
        stableSince = Date.now();
      }
    }
    return { reason: "timed-out", durationMs: Date.now() - startedAt };
  }

  private async collectInteractiveElements(): Promise<{
    elements: ExploredInteractiveElementV2[];
    refs: Map<string, RefEntry>;
  }> {
    const all = this.page.locator(interactiveSelector);
    const count = Math.min(await all.count(), 200);
    const elements: ExploredInteractiveElementV2[] = [];
    const refs = new Map<string, RefEntry>();
    const baseOrigin = new URL(this.config.baseUrl).origin;

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
            inputType: element instanceof HTMLInputElement ? element.type : undefined,
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
        expectedCount = await this.page
          .getByRole(
            primary.role as Parameters<Page["getByRole"]>[0],
            primary.name ? { name: primary.name, exact: primary.exact ?? true } : {},
          )
          .count()
          .catch(() => undefined);
      } else if (primary?.by === "test-id") {
        expectedCount = await this.page
          .getByTestId(primary.testId)
          .count()
          .catch(() => undefined);
      } else if (primary?.by === "css") {
        expectedCount = await this.page
          .locator(primary.selector)
          .count()
          .catch(() => undefined);
      } else if (primary?.by === "text") {
        expectedCount = await this.page
          .getByText(primary.text, { exact: primary.exact ?? true })
          .count()
          .catch(() => undefined);
      }
      const expanded =
        facts.expanded === null || facts.expanded === undefined
          ? undefined
          : facts.expanded === "true";
      const risk = riskForElement({
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
        ...(facts.href ? { href: sanitizedUrl(facts.href) } : {}),
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

  async observe(reason = "agent-request", settled?: Settled): Promise<ExplorationObservation> {
    const sequence = ++this.observationSequence;
    const id = `obs-${String(sequence).padStart(4, "0")}`;
    const snapshotPath = join(this.config.outputDirectory, "snapshots", `${id}.yml`);
    const screenshotPath = join(this.config.outputDirectory, "screenshots", `${id}.png`);
    const observationPath = join(this.config.outputDirectory, "observations", `${id}.json`);
    const snapshot = await this.page.ariaSnapshot({ mode: "ai", depth: 12, timeout: 5_000 });
    await Promise.all([
      writeFile(snapshotPath, `${snapshot.trimEnd()}\n`),
      this.page.screenshot({ path: screenshotPath, fullPage: false, scale: "css" }),
    ]);
    const { elements, refs } = await this.collectInteractiveElements();
    const headings = await this.page
      .locator("h1, h2, h3, [role=heading]")
      .evaluateAll((nodes) =>
        nodes
          .filter((node) => {
            const style = getComputedStyle(node);
            const bounds = node.getBoundingClientRect();
            return style.visibility !== "hidden" && style.display !== "none" && bounds.width > 0;
          })
          .map((node) => node.textContent?.trim().replace(/\s+/g, " ").slice(0, 300) ?? "")
          .filter(Boolean)
          .slice(0, 50),
      )
      .catch(() => []);
    const layers = await this.page
      .locator('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')
      .evaluateAll((nodes) =>
        nodes
          .filter((node) => {
            const style = getComputedStyle(node);
            const bounds = node.getBoundingClientRect();
            return style.visibility !== "hidden" && style.display !== "none" && bounds.width > 0;
          })
          .map((node) => ({
            role: node.getAttribute("role") ?? "layer",
            name:
              node.getAttribute("aria-label") ??
              node.textContent?.trim().replace(/\s+/g, " ").slice(0, 200) ??
              "",
          })),
      )
      .catch(() => []);
    const scroll = await this.page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    const currentUrl = this.page.url();
    const normalizedSnapshot = snapshot
      .replaceAll(/\[ref=e\d+\]/g, "")
      .replaceAll(/\[box=[^\]]+\]/g, "")
      .replaceAll(/\s+/g, " ")
      .trim();
    const semanticFingerprint = createHash("sha256")
      .update(`${new URL(currentUrl).pathname}\n${normalizedSnapshot}`)
      .digest("hex");
    let stateId = this.states.get(semanticFingerprint);
    if (!stateId) {
      stateId = `state-${String(++this.stateSequence).padStart(4, "0")}`;
      this.states.set(semanticFingerprint, stateId);
    }
    const observation = explorationObservationSchema.parse({
      schemaVersion: 2,
      id,
      sequence,
      stateId,
      reason,
      createdAt: new Date().toISOString(),
      url: sanitizedUrl(currentUrl),
      pathname: new URL(currentUrl).pathname,
      title: await this.page.title(),
      viewport,
      scroll,
      headings,
      layers,
      interactiveElements: elements,
      errors: this.errors.splice(0, 50),
      artifacts: {
        snapshot: pathForArtifact(this.config.outputDirectory, snapshotPath),
        screenshot: pathForArtifact(this.config.outputDirectory, screenshotPath),
        observation: pathForArtifact(this.config.outputDirectory, observationPath),
      },
      semanticFingerprint,
      settled: settled ?? { reason: "explicit", durationMs: 0 },
    });
    await writeFile(observationPath, `${JSON.stringify(observation, null, 2)}\n`);
    this.refs = refs;
    this.currentObservation = observation;
    this.observations.push(observation);
    await this.writeGraph();
    await this.writeReport("active");
    return observation;
  }

  find(input: unknown): ExplorationFindResult {
    const query = explorationFindQuerySchema.parse(input);
    const observation = this.currentObservation;
    if (!observation) throw new Error("Exploration session has no current observation");
    let matchesText: (value: string) => boolean;
    if (query.text) {
      const expected = query.text.toLocaleLowerCase();
      matchesText = (value) => value.toLocaleLowerCase().includes(expected);
    } else {
      const pattern = query.regex;
      if (!pattern) throw new Error("Exploration regex search is missing its pattern");
      let regex: RegExp;
      try {
        regex = new RegExp(pattern);
      } catch (error) {
        throw new Error(`Invalid exploration search regular expression: ${query.regex}`, {
          cause: error,
        });
      }
      matchesText = (value) => regex.test(value);
    }
    const matches: ExplorationFindResult["matches"] = [];
    for (const element of observation.interactiveElements) {
      if (!matchesText(`${element.role ?? ""} ${element.name}`)) continue;
      matches.push({
        kind: "element",
        ref: element.ref,
        ...(element.role ? { role: element.role } : {}),
        text: element.name,
        risk: element.risk,
      });
    }
    for (const heading of observation.headings) {
      if (matchesText(heading)) matches.push({ kind: "heading", role: "heading", text: heading });
    }
    for (const layer of observation.layers) {
      if (matchesText(`${layer.role} ${layer.name}`))
        matches.push({ kind: "layer", role: layer.role, text: layer.name });
    }
    return explorationFindResultSchema.parse({
      observationId: observation.id,
      matches: matches.slice(0, 50),
    });
  }

  private async refreshRefEntry(entry: RefEntry): Promise<RefEntry> {
    if (!(await entry.locator.isVisible().catch(() => false)))
      throw new Error(
        `Element ${entry.element.ref} is no longer visible; request a new observation`,
      );
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
          inputType: element instanceof HTMLInputElement ? element.type : undefined,
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
    ) {
      throw new Error(
        `Element ${entry.element.ref} changed since ${this.currentObservation?.id ?? "the last observation"}; request a new observation`,
      );
    }
    const expanded =
      current.expanded === null || current.expanded === undefined
        ? undefined
        : current.expanded === "true";
    const risk = riskForElement({
      ...(role ? { role } : {}),
      name,
      tagName: current.tagName,
      ...(current.inputType ? { inputType: current.inputType } : {}),
      ...(current.href ? { href: current.href } : {}),
      ...(expanded === undefined ? {} : { expanded }),
      baseOrigin: new URL(this.config.baseUrl).origin,
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

  private policyFor(action: ExplorationAction, entry?: RefEntry): ExplorationTransition["policy"] {
    if (action.type === "goto") {
      let destination: URL;
      try {
        destination = new URL(action.url, this.config.baseUrl);
      } catch {
        return { allowed: false, risk: "unknown", reasons: ["Navigation URL is invalid"] };
      }
      if (destination.origin !== new URL(this.config.baseUrl).origin) {
        return {
          allowed: false,
          risk: "external-side-effect",
          reasons: ["Navigation leaves the allowed origin"],
        };
      }
    }
    if (action.type !== "click")
      return {
        allowed: true,
        risk: entry?.element.risk ?? "read-only",
        reasons: ["Action is allowed by the bounded exploration protocol"],
      };
    if (!entry)
      return {
        allowed: false,
        risk: "unknown",
        reasons: ["Element reference does not exist in the current observation"],
      };
    const allowed =
      entry.element.risk === "read-only" ||
      (this.config.policy === "reversible" && entry.element.risk === "reversible");
    return {
      allowed,
      risk: entry.element.risk,
      reasons: allowed
        ? entry.element.riskReasons
        : [
            ...entry.element.riskReasons,
            `Policy ${this.config.policy} does not allow ${entry.element.risk} actions`,
          ],
    };
  }

  async act(input: unknown): Promise<ExplorationTransition> {
    this.ensureWithinLimits();
    const action = explorationActionSchema.parse(input);
    this.actionCount += 1;
    const before = this.currentObservation;
    if (!before) throw new Error("Exploration session has no current observation");
    let entry = "ref" in action ? this.refs.get(action.ref) : undefined;
    if ("observationId" in action && action.observationId !== before.id)
      throw new Error(
        `Stale observation reference: expected ${before.id}, received ${action.observationId}`,
      );
    if (entry) entry = await this.refreshRefEntry(entry);
    const policy = this.policyFor(action, entry);
    const sequence = ++this.transitionSequence;
    const id = `transition-${String(sequence).padStart(4, "0")}`;
    const startedAt = Date.now();
    this.popupBlocked = false;
    this.downloadBlocked = false;
    this.dialogDismissed = false;

    if (!policy.allowed) {
      const blocked = explorationTransitionSchema.parse({
        schemaVersion: 2,
        id,
        sequence,
        createdAt: new Date().toISOString(),
        action,
        status: "blocked",
        policy,
        fromObservationId: before.id,
        fromStateId: before.stateId,
        ...(entry ? { target: entry.element.target } : {}),
        outcome: {
          urlChanged: false,
          semanticChanged: false,
          popupBlocked: false,
          downloadBlocked: false,
          dialogDismissed: false,
        },
        durationMs: Date.now() - startedAt,
      });
      await this.persistTransition(blocked);
      return blocked;
    }

    try {
      if (action.type === "click") {
        if (!entry) throw new Error(`Unknown element reference: ${action.ref}`);
        if (!entry.element.enabled) throw new Error(`Element ${action.ref} is disabled`);
        await entry.locator.click({ timeout: 5_000 });
      } else if (action.type === "hover") {
        if (!entry) throw new Error(`Unknown element reference: ${action.ref}`);
        await entry.locator.hover({ timeout: 5_000 });
      } else if (action.type === "goto") {
        const destination = new URL(action.url, this.config.baseUrl);
        if (destination.origin !== new URL(this.config.baseUrl).origin)
          throw new Error(`Cross-origin navigation is blocked: ${sanitizedUrl(destination.href)}`);
        await this.page.goto(destination.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
      } else if (action.type === "back") {
        await this.page.goBack({ waitUntil: "domcontentloaded", timeout: 30_000 });
      } else if (action.type === "scroll") {
        await this.page.mouse.wheel(action.deltaX, action.deltaY);
      } else {
        await this.page.waitForTimeout(action.durationMs);
      }
      const settled = await this.waitForSemanticQuiet(
        action.type === "wait" ? "explicit" : undefined,
      );
      const after = await this.observe(`after-${action.type}`, settled);
      const transition = explorationTransitionSchema.parse({
        schemaVersion: 2,
        id,
        sequence,
        createdAt: new Date().toISOString(),
        action,
        status: "succeeded",
        policy,
        fromObservationId: before.id,
        fromStateId: before.stateId,
        toObservationId: after.id,
        toStateId: after.stateId,
        ...(entry ? { target: entry.element.target } : {}),
        outcome: {
          urlChanged: before.url !== after.url,
          semanticChanged: before.semanticFingerprint !== after.semanticFingerprint,
          popupBlocked: this.popupBlocked,
          downloadBlocked: this.downloadBlocked,
          dialogDismissed: this.dialogDismissed,
          settledReason: settled.reason === "initial" ? "quiet" : settled.reason,
        },
        durationMs: Date.now() - startedAt,
      });
      await this.persistTransition(transition);
      return transition;
    } catch (error) {
      const transition = explorationTransitionSchema.parse({
        schemaVersion: 2,
        id,
        sequence,
        createdAt: new Date().toISOString(),
        action,
        status: "failed",
        policy,
        fromObservationId: before.id,
        fromStateId: before.stateId,
        ...(entry ? { target: entry.element.target } : {}),
        outcome: {
          urlChanged: before.url !== sanitizedUrl(this.page.url()),
          semanticChanged: false,
          popupBlocked: this.popupBlocked,
          downloadBlocked: this.downloadBlocked,
          dialogDismissed: this.dialogDismissed,
        },
        durationMs: Date.now() - startedAt,
        error: sanitizedError(error instanceof Error ? error.message : String(error)),
      });
      await this.persistTransition(transition);
      return transition;
    }
  }

  private async persistTransition(transition: ExplorationTransition): Promise<void> {
    this.transitions.push(transition);
    await appendFile(
      join(this.config.outputDirectory, "transitions.ndjson"),
      `${JSON.stringify(transition)}\n`,
    );
    await this.writeGraph();
    await this.writeReport("active");
  }

  private async writeGraph(): Promise<void> {
    const states = [...this.states.entries()].map(([fingerprint, id]) => ({ id, fingerprint }));
    await writeFile(
      join(this.config.outputDirectory, "graph.json"),
      `${JSON.stringify(
        {
          schemaVersion: 2,
          states,
          observations: this.observations.map((observation) => ({
            id: observation.id,
            stateId: observation.stateId,
            sequence: observation.sequence,
          })),
          transitions: this.transitions.map((transition) => ({
            id: transition.id,
            status: transition.status,
            fromStateId: transition.fromStateId,
            ...(transition.toStateId ? { toStateId: transition.toStateId } : {}),
          })),
        },
        null,
        2,
      )}\n`,
    );
  }

  report(status: ExplorationSessionReport["status"] = "active"): ExplorationSessionReport {
    return explorationSessionReportSchema.parse({
      schemaVersion: 2,
      id: this.config.id,
      createdAt: this.createdAt,
      ...(status === "active" ? {} : { finishedAt: new Date().toISOString() }),
      status,
      target: {
        baseUrl: sanitizedUrl(this.config.baseUrl),
        ...(this.config.repositoryPath ? { repositoryPath: this.config.repositoryPath } : {}),
      },
      ...(this.config.goal ? { goal: this.config.goal } : {}),
      policy: this.config.policy,
      limits: { maxActions: this.config.maxActions, maxDurationMs: this.config.maxDurationMs },
      metrics: {
        observations: this.observations.length,
        states: this.states.size,
        transitions: this.transitions.length,
        actions: this.actionCount,
      },
      ...(this.currentObservation ? { latestObservationId: this.currentObservation.id } : {}),
    });
  }

  private async writeReport(status: ExplorationSessionReport["status"]): Promise<void> {
    const report = this.report(status);
    await writeFile(
      join(this.config.outputDirectory, "exploration.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    const latest = this.currentObservation;
    const lines = [
      `# Exploration: ${report.target.baseUrl}`,
      "",
      `Status: ${status}`,
      `Policy: ${report.policy}`,
      `Observations: ${report.metrics.observations}`,
      `States: ${report.metrics.states}`,
      `Transitions: ${report.metrics.transitions}`,
      "",
    ];
    if (latest) {
      lines.push(
        "## Latest observation",
        "",
        `- ID: ${latest.id}`,
        `- URL: ${latest.url}`,
        `- Title: ${latest.title}`,
        `- Headings: ${latest.headings.join("; ") || "none"}`,
        `- Interactive elements: ${latest.interactiveElements.length}`,
        `- Snapshot: ${latest.artifacts.snapshot}`,
        `- Screenshot: ${latest.artifacts.screenshot}`,
        "",
      );
    }
    await writeFile(join(this.config.outputDirectory, "summary.md"), `${lines.join("\n")}\n`);
  }

  async close(status: "finished" | "aborted" | "failed" = "finished"): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.writeReport(status).catch(() => undefined);
    await this.context?.tracing
      .stop({ path: join(this.config.outputDirectory, "diagnostics", "trace.zip") })
      .catch(() => undefined);
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
  }
}
