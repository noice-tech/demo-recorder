import type { Browser, BrowserContext, Locator, Page } from "playwright";
import {
  describeTarget,
  type Action,
  type Expect,
  type Target,
} from "@noice-tech/demo-recorder-core";
import { startCdpRecorder } from "../recorder/cdp.js";
import { enableBoundary } from "./boundary.js";
import { snapshotEntries } from "./aria.js";
import type { PageInspection, Recorder, ResolvedRef, Session } from "./types.js";

/** Element facts the policy needs that the ARIA snapshot does not carry. */
const ELEMENT_FACTS = (element: Element) => ({
  tag: element.tagName.toLowerCase(),
  inputType: element.getAttribute("type"),
  inForm: Boolean(element.closest("form")),
  href: element instanceof HTMLAnchorElement ? element.href : null,
  download: element.hasAttribute("download"),
  target: element.getAttribute("target"),
});

/**
 * Resolves a durable target. Role and name match the exact accessible name, and
 * search every frame of the page (one frame per match), like the AI snapshot does.
 */
function locatorFor(page: Page, target: Target, exact = true): Locator {
  if (target.selector) return page.locator(target.selector);
  const root = target.within
    ? page.frameLocator().getByRole(target.within.role as never, {
        name: target.within.name,
        exact: true,
      })
    : page.frameLocator();
  if (target.role && target.name)
    return root.getByRole(target.role as never, { name: target.name, exact });
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
  const names = lines.map((line) => /^- (\S+ "(?:[^"\\]|\\.)*")/.exec(line)?.[1]).filter(Boolean);
  return names.length === 0 ? "" : ` (names match exactly; closest: ${names.join(", ")})`;
}

async function unique(page: Page, target: Target): Promise<Locator> {
  const locator = locatorFor(page, target);
  const count = await countMatches(locator);
  if (count === 0) {
    throw new Error(
      `No element matches ${describeTarget(target)}${await nearMatches(page, target)}`,
    );
  }
  if (count > 1) {
    throw new Error(`${describeTarget(target)} matches ${count} elements; it must be unique`);
  }
  return locator.first();
}

async function waitForExpectation(page: Page, expect: Expect): Promise<void> {
  const timeoutMs = expect.timeoutMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;
  let lastState = "";
  while (Date.now() <= deadline) {
    const urlOk = !expect.url || page.url().includes(expect.url);
    let visibleOk = true;
    if (expect.visible) {
      const locator = locatorFor(page, expect.visible);
      const count = await countMatches(locator);
      visibleOk = count > 0 && (await locator.first().isVisible());
    }
    if (urlOk && visibleOk) return;
    lastState = `url=${page.url()}, urlExpected=${expect.url ?? "-"}, visible=${
      expect.visible ? (visibleOk ? "yes" : "no") : "-"
    }`;
    await page.waitForTimeout(50);
  }
  throw new Error(`Expectation did not hold within ${timeoutMs}ms (${lastState})`);
}

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
  /** Enable the runtime effect boundary for this session. */
  guarded: boolean;
  pid?: number;
};

/** Builds a driver session over one page of a launched or attached browser. */
export async function createBrowserSession(input: BrowserSessionInput): Promise<Session> {
  const { browser, context, viewport } = input;
  let page = input.page;
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  const boundary = input.guarded
    ? await enableBoundary(context, page).catch(() => undefined)
    : undefined;

  return {
    target: input.target,
    guarded: Boolean(boundary?.active),
    ...(input.pid === undefined ? {} : { pid: input.pid }),
    async listPages() {
      return listPages(context);
    },
    async selectPage(id: string) {
      page = await selectPage(context, id);
    },
    async goto(url: string) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    },
    async perform(action: Action) {
      if (action.type === "navigate") {
        await page.goto(action.url, { waitUntil: "domcontentloaded" });
        return;
      }
      if (action.type === "scroll") {
        await page.mouse.wheel(action.deltaX ?? 0, action.deltaY);
        return;
      }
      if (action.type === "hold") {
        await page.waitForTimeout(action.durationMs);
        return;
      }
      if (action.type === "press") {
        if ("target" in action && action.target) {
          await (await unique(page, action.target)).press(action.key);
        } else {
          await page.keyboard.press(action.key);
        }
        return;
      }
      if (action.type === "fill" && "target" in action && action.target) {
        await (await unique(page, action.target)).fill(action.value);
        return;
      }
      if (action.type === "select" && "target" in action && action.target) {
        await (await unique(page, action.target)).selectOption(action.value);
        return;
      }
      if (action.type === "click" && "target" in action && action.target) {
        await (await unique(page, action.target)).click();
        return;
      }
      throw new Error(`Action ${action.type} is not supported by this driver`);
    },
    async waitFor(expect: Expect) {
      await waitForExpectation(page, expect);
    },
    async countMatches(target: Target) {
      return countMatches(locatorFor(page, target));
    },
    async bounds(target: Target) {
      // Report a missing target at once; the action then explains what is missing.
      const locator = locatorFor(page, target);
      if ((await countMatches(locator)) === 0) return undefined;
      return (await locator.first().boundingBox()) ?? undefined;
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
      const snapshot = await page.ariaSnapshot({ mode: "ai" });
      const [tree, scroll] = await Promise.all([
        page.ariaSnapshotJSON({ mode: "ai" }),
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
      const entry = snapshotEntries(await page.ariaSnapshotJSON({ mode: "ai" })).find(
        (candidate) => candidate.path.join(".") === key,
      );
      if (!entry) return undefined;
      const facts = await page.getByRef(entry.ref).evaluate(ELEMENT_FACTS);
      return { ...entry, facts };
    },
    async snapshot() {
      return page.ariaSnapshot({ mode: "ai" });
    },
    async screenshot(path: string) {
      await page.screenshot({ path });
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
      await boundary?.dispose().catch(() => undefined);
      if (input.ownsLifecycle) await browser.close().catch(() => undefined);
    },
  };
}
