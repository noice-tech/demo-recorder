import type { Browser, BrowserContext, Locator, Page } from "playwright";
import {
  describeTarget,
  type Action,
  type Expect,
  type Target,
} from "@noice-tech/demo-recorder-core";
import { startCdpRecorder } from "../recorder/cdp.js";
import { ACTION_TIMEOUT_MS, actionFailure } from "./action-error.js";
import { enableBoundary } from "./boundary.js";
import { snapshotEntries, withoutIconGlyphs } from "./aria.js";
import { watchNavigation, type NavigationLog } from "./navigation.js";
import type { PageInspection, Recorder, ResolvedRef, Session } from "./types.js";

// A stalled navigation blocks snapshots and screenshots, so they must time out.
const PAGE_READ_TIMEOUT_MS = 10_000;
const AI_SNAPSHOT = { mode: "ai", timeout: PAGE_READ_TIMEOUT_MS } as const;

/** Element facts the policy needs that the ARIA snapshot does not carry. */
const ELEMENT_FACTS = (element: Element) => ({
  tag: element.tagName.toLowerCase(),
  inputType: element.getAttribute("type"),
  inForm: Boolean(element.closest("form")),
  href: element instanceof HTMLAnchorElement ? element.href : null,
  download: element.hasAttribute("download"),
  target: element.getAttribute("target"),
});

/** The exact accessible name, ignoring icon-font glyphs around it. */
function exactName(name: string): RegExp {
  const glyphs = String.raw`[\uE000-\uF8FF\s]*`;
  const literal = name.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return new RegExp(`^${glyphs}${literal}${glyphs}$`, "u");
}

/**
 * Resolves a durable target. Role and name match the exact accessible name, and
 * search every frame of the page (one frame per match), like the AI snapshot does.
 */
function locatorFor(page: Page, target: Target, exact = true): Locator {
  if (target.selector) {
    const locator = page.locator(target.selector);
    // Responsive sites keep hidden copies of controls; a ref already names one element.
    return target.selector.startsWith("aria-ref=") ? locator : locator.filter({ visible: true });
  }
  const root = target.within
    ? page.frameLocator().getByRole(target.within.role as never, {
        name: exactName(target.within.name),
      })
    : page.frameLocator();
  if (target.role && target.name)
    return root.getByRole(target.role as never, {
      name: exact ? exactName(target.name) : target.name,
    });
  if (target.role) return root.getByRole(target.role as never);
  if (target.name) return root.getByText(target.name);
  throw new Error("Target has no role, name, or selector");
}

const MULTIPLE_FRAMES = /matched elements in multiple frames/;

/** Live matches of a locator; a match in more than one frame is ambiguous. */
async function countMatches(locator: Locator): Promise<number> {
  try {
    return await locator.count();
  } catch (error) {
    if (error instanceof Error && MULTIPLE_FRAMES.test(error.message)) return 2;
    throw error;
  }
}

/** Full names of elements whose name merely contains the target's, for the error. */
async function nearMatches(page: Page, target: Target): Promise<string> {
  if (!target.role || !target.name) return "";
  const loose = locatorFor(page, target, false);
  const count = await countMatches(loose).catch(() => 0);
  if (count === 0 || count > 3) return "";
  const lines = await Promise.all(
    Array.from({ length: count }, (_, index) => loose.nth(index).ariaSnapshot({ timeout: 1_000 })),
  ).catch(() => []);
  const names = lines
    .map((line) => /^- (\S+ "(?:[^"\\]|\\.)*")/.exec(withoutIconGlyphs(line))?.[1])
    .filter(Boolean);
  return names.length === 0 ? "" : ` (names match exactly; closest: ${names.join(", ")})`;
}

async function unique(page: Page, target: Target): Promise<Locator> {
  const locator = locatorFor(page, target);
  const deadline = Date.now() + ACTION_TIMEOUT_MS;
  let count = await countMatches(locator);
  // A near match means a mistyped name, which waiting cannot fix.
  let near = count === 0 ? await nearMatches(page, target) : "";
  // Banners and late content often appear just after the page does.
  while (count === 0 && !near && Date.now() < deadline) {
    await page.waitForTimeout(100);
    count = await countMatches(locator);
  }
  if (count === 0) {
    near ||= await nearMatches(page, target);
    throw new Error(`No element matches ${describeTarget(target)}${near}`);
  }
  if (count > 1) {
    throw new Error(`${describeTarget(target)} matches ${count} elements; it must be unique`);
  }
  return locator.first();
}

async function onTarget(
  page: Page,
  target: Target,
  verb: string,
  run: (locator: Locator) => Promise<unknown>,
): Promise<void> {
  const locator = await unique(page, target);
  try {
    await run(locator);
  } catch (error) {
    throw actionFailure(error, verb, describeTarget(target));
  }
}

async function waitForExpectation(
  page: Page,
  expect: Expect,
  activity: () => string,
): Promise<void> {
  const timeoutMs = expect.timeoutMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;
  let problems: string[] = [];
  while (Date.now() <= deadline) {
    problems = [];
    if (expect.url && !page.url().includes(expect.url)) {
      problems.push(`the URL is ${page.url()}, not one containing ${expect.url}`);
    }
    if (expect.visible) {
      const locator = locatorFor(page, expect.visible);
      const count = await countMatches(locator);
      if (count === 0) problems.push(`no ${describeTarget(expect.visible)} is in the page`);
      else if (!(await locator.first().isVisible())) {
        problems.push(`${describeTarget(expect.visible)} is in the page but not visible`);
      }
    }
    if (problems.length === 0) return;
    await page.waitForTimeout(50);
  }
  const detail = activity();
  throw new Error(
    `Expectation did not hold within ${timeoutMs}ms: ${problems.join(", and ")}.${detail ? ` ${detail}` : ""}`,
  );
}

/**
 * Whether a radio or checkbox sits under its own label, as custom controls often
 * do. Playwright refuses that click; a person clicks the label, which works.
 */
const UNDER_OWN_LABEL = (element: Element): boolean => {
  if (!(element instanceof HTMLInputElement) || !["radio", "checkbox"].includes(element.type)) {
    return false;
  }
  if (element.disabled || !element.labels?.length) return false;
  element.scrollIntoView({ block: "nearest", inline: "nearest" });
  const box = element.getBoundingClientRect();
  const hit = element.ownerDocument.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
  return (
    hit !== null && hit !== element && [...element.labels].some((label) => label.contains(hit))
  );
};

const INTERACTIONS = new Set<Action["type"]>(["navigate", "click", "fill", "press", "select"]);

async function pageId(page: Page): Promise<string> {
  const connection = await page.context().newCDPSession(page);
  try {
    const { targetInfo } = await connection.send("Target.getTargetInfo");
    return targetInfo.targetId;
  } finally {
    await connection.detach();
  }
}

export async function listPages(context: BrowserContext) {
  return Promise.all(
    context.pages().map(async (page) => ({
      id: await pageId(page),
      url: page.url(),
      title: await page.title(),
    })),
  );
}

export async function selectPage(context: BrowserContext, selectedId?: string): Promise<Page> {
  const pages = context.pages();
  if (selectedId !== undefined) {
    for (const page of pages) {
      if ((await pageId(page)) === selectedId) return page;
    }
    throw new Error(`Selected page ${selectedId} is gone`);
  }
  const first = pages[0];
  return first ?? (await context.newPage());
}

export type BrowserSessionInput = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  target: string;
  viewport: { width: number; height: number };
  ownsLifecycle: boolean;
  capture: boolean;
  allowedOrigins?: readonly string[];
  pid?: number;
};

/** Builds a driver session over one page of a launched or attached browser. */
export async function createBrowserSession(input: BrowserSessionInput): Promise<Session> {
  const { browser, context, viewport } = input;
  let page = input.page;
  const errors: string[] = [];
  let navigation: NavigationLog;
  const watch = (watched: Page): void => {
    watched.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    watched.on("pageerror", (error) => errors.push(error.message));
    navigation = watchNavigation(watched);
  };
  watch(page);

  const boundary = input.allowedOrigins
    ? await enableBoundary(context, page, input.allowedOrigins).catch(() => undefined)
    : undefined;
  let blockedSince = 0;
  const blockedNow = (): readonly string[] => boundary?.blocked.slice(blockedSince) ?? [];

  const activity = (expectingNavigation: boolean): string => {
    const blocked = blockedNow();
    return [
      navigation.describe(expectingNavigation || blocked.length > 0),
      blocked.length > 0 ? `The recording boundary blocked: ${blocked.join("; ")}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  };

  return {
    target: input.target,
    guarded: boundary !== undefined,
    ...(input.pid === undefined ? {} : { pid: input.pid }),
    async listPages() {
      return listPages(context);
    },
    async selectPage(id: string) {
      page = await selectPage(context, id);
      watch(page);
    },
    async goto(url: string) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      // Redirects bypass the route handler, so allow wherever the entry URL led.
      boundary?.allow(page.url());
    },
    async perform(action: Action) {
      if (INTERACTIONS.has(action.type)) {
        navigation.reset(action.type);
        blockedSince = boundary?.blocked.length ?? 0;
      }
      if (action.type === "navigate") {
        await page.goto(action.url, { waitUntil: "domcontentloaded" }).catch((error: unknown) => {
          const blocked = blockedNow();
          throw blocked.length > 0
            ? new Error(`The recording boundary blocked ${blocked.join("; ")}`)
            : error;
        });
        return;
      }
      if (action.type === "scroll") {
        await page.mouse.wheel(action.deltaX ?? 0, action.deltaY ?? 0);
        return;
      }
      if (action.type === "hold") {
        await page.waitForTimeout(action.durationMs);
        return;
      }
      const timeout = ACTION_TIMEOUT_MS;
      if (action.type === "press") {
        if ("target" in action && action.target) {
          await onTarget(page, action.target, "press a key on", (locator) =>
            locator.press(action.key, { timeout }),
          );
        } else {
          await page.keyboard.press(action.key);
        }
        return;
      }
      if (action.type === "fill" && "target" in action && action.target) {
        await onTarget(page, action.target, "fill", (locator) =>
          locator.fill(action.value, { timeout }),
        );
        return;
      }
      if (action.type === "select" && "target" in action && action.target) {
        await onTarget(page, action.target, "select an option in", (locator) =>
          locator.selectOption(action.value, { timeout }),
        );
        return;
      }
      if (action.type === "click" && "target" in action && action.target) {
        // Playwright would fail the click on a stalled navigation; settle waits the
        // same way but leaves the verdict to the step's expect.
        await onTarget(page, action.target, "click", async (locator) => {
          const force = await locator.evaluate(UNDER_OWN_LABEL, undefined, { timeout });
          await locator.click({ noWaitAfter: true, timeout, force });
        });
        await navigation.settle(timeout);
        return;
      }
      throw new Error(`Action ${action.type} is not supported by this driver`);
    },
    blocked: blockedNow,
    async waitFor(expect: Expect) {
      await waitForExpectation(page, expect, () => activity(Boolean(expect.url)));
    },
    async countMatches(target: Target) {
      return countMatches(locatorFor(page, target));
    },
    async bounds(target: Target) {
      const locator = await unique(page, target);
      return (await locator.boundingBox({ timeout: ACTION_TIMEOUT_MS })) ?? undefined;
    },
    async mouseMove(x: number, y: number) {
      await page.mouse.move(x, y);
    },
    async scrollPosition() {
      return (await page.evaluate("({ x: window.scrollX, y: window.scrollY })")) as {
        x: number;
        y: number;
      };
    },
    async url() {
      return page.url();
    },
    async inspect(): Promise<PageInspection> {
      // The YAML is what the agent reads; the JSON gives the same refs as data.
      const snapshot = withoutIconGlyphs(await page.ariaSnapshot(AI_SNAPSHOT));
      const [tree, scroll] = await Promise.all([
        page.ariaSnapshotJSON(AI_SNAPSHOT),
        page.evaluate("({ x: window.scrollX, y: window.scrollY })") as Promise<{
          x: number;
          y: number;
        }>,
      ]);
      return {
        url: page.url(),
        title: await page.title(),
        scroll,
        snapshot,
        elements: snapshotEntries(tree).map(({ ref, role, name, path }) =>
          name === undefined ? { ref, role, path } : { ref, role, name, path },
        ),
        errors: errors.slice(-20),
      };
    },
    async resolveElement(path: number[]): Promise<ResolvedRef | undefined> {
      const key = path.join(".");
      const entry = snapshotEntries(await page.ariaSnapshotJSON(AI_SNAPSHOT)).find(
        (candidate) => candidate.path.join(".") === key,
      );
      if (!entry) return undefined;
      const facts = await page
        .getByRef(entry.ref)
        .evaluate(ELEMENT_FACTS, undefined, { timeout: ACTION_TIMEOUT_MS });
      return { ...entry, facts };
    },
    async snapshot() {
      return withoutIconGlyphs(await page.ariaSnapshot(AI_SNAPSHOT));
    },
    async screenshot(path: string) {
      await page.screenshot({ path, timeout: PAGE_READ_TIMEOUT_MS });
    },
    async saveStorageState(path: string) {
      await context.storageState({ path });
    },
    async startCapture(path: string): Promise<Recorder> {
      if (!input.capture) throw new Error("This driver does not support the capture capability");
      const capture = await startCdpRecorder({
        page,
        outputPath: path,
        width: viewport.width,
        height: viewport.height,
      });
      return {
        startedAtNs: capture.startedAtNs,
        async stop() {
          const diagnostics = await capture.stop();
          return { durationMs: (diagnostics.emittedFrames / diagnostics.fps) * 1000 };
        },
        async abort() {
          await capture.abort();
        },
      };
    },
    async close() {
      // Unrouting can block on a stalled navigation; closing the browser drops the route anyway.
      if (input.ownsLifecycle) await browser.close().catch(() => undefined);
      else await boundary?.dispose().catch(() => undefined);
    },
  };
}
