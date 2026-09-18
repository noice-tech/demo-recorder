import type { Browser, BrowserContext, Locator, Page } from "playwright";
import type { Action, Expect, Target } from "@noice-tech/demo-recorder-core";
import { classifyRisk } from "../policy.js";
import { startCdpRecorder } from "../recorder/cdp.js";
import { enableBoundary } from "./boundary.js";
import type { ObservedElement, PageInspection, Recorder, Session } from "./types.js";

type RawElement = {
  role: string;
  name: string;
  visible: boolean;
  enabled: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  selector: string;
  tag: string;
  inputType: string | null;
  inForm: boolean;
  href: string | null;
  download: boolean;
  target: string | null;
};

type RawInspection = {
  url: string;
  title: string;
  scroll: { x: number; y: number };
  headings: string[];
  elements: RawElement[];
};

/**
 * Runs in the browser. It is a string because bundlers inject name-preserving
 * helpers into serialized functions, which the page cannot resolve.
 */
const INSPECTION_SCRIPT = `(() => {
  const roleOf = (el) => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit.split(/\\s+/)[0] || "generic";
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return el.hasAttribute("href") ? "link" : "generic";
    if (tag === "button") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "summary") return "button";
    if (tag === "img") return "img";
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (["submit", "button", "reset", "image"].indexOf(type) >= 0) return "button";
      if (type === "range") return "slider";
      if (type === "number") return "spinbutton";
      return "textbox";
    }
    return "generic";
  };

  const nameOf = (el) => {
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return aria.trim();
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const text = labelledby
        .split(/\\s+/)
        .map((id) => (document.getElementById(id) ? document.getElementById(id).textContent : ""))
        .join(" ")
        .trim();
      if (text) return text;
    }
    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement
    ) {
      const labels = el.labels
        ? Array.from(el.labels)
            .map((label) => label.textContent || "")
            .join(" ")
            .trim()
        : "";
      if (labels) return labels;
      if (el instanceof HTMLInputElement && el.placeholder) return el.placeholder;
      if (
        el instanceof HTMLInputElement &&
        ["submit", "button"].indexOf(el.type) >= 0 &&
        el.value
      )
        return el.value;
    }
    if (el instanceof HTMLImageElement && el.alt) return el.alt;
    const text = (el.textContent || "").replace(/\\s+/g, " ").trim();
    if (text) return text.slice(0, 120);
    const title = el.getAttribute("title");
    return title ? title.trim() : "";
  };

  const selectorOf = (el) => {
    if (el.id) return "#" + CSS.escape(el.id);
    const parts = [];
    let node = el;
    while (node && node !== document.documentElement) {
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (child) => child.tagName === node.tagName,
        );
        if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(" > ");
  };

  const candidates = Array.from(
    document.querySelectorAll(
      'a,button,input,select,textarea,summary,[role],[contenteditable="true"],h1,h2,h3,h4,h5,h6',
    ),
  );
  const elements = [];
  for (const el of candidates) {
    const role = roleOf(el);
    if (role === "generic" && !el.hasAttribute("role")) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const style = getComputedStyle(el);
    const disabled =
      el instanceof HTMLButtonElement ||
      el instanceof HTMLInputElement ||
      el instanceof HTMLSelectElement ||
      el instanceof HTMLTextAreaElement
        ? el.disabled
        : false;
    elements.push({
      role: role,
      name: nameOf(el),
      visible: style.visibility !== "hidden" && style.display !== "none",
      enabled: !disabled,
      bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      selector: selectorOf(el),
      tag: el.tagName.toLowerCase(),
      inputType: el.getAttribute("type"),
      inForm: Boolean(el.closest("form")),
      href: el instanceof HTMLAnchorElement ? el.href : null,
      download: el.hasAttribute("download"),
      target: el.getAttribute("target"),
    });
  }
  return {
    url: location.href,
    title: document.title,
    scroll: { x: window.scrollX, y: window.scrollY },
    headings: Array.from(document.querySelectorAll("h1,h2,h3"))
      .map((heading) => (heading.textContent || "").trim())
      .filter(Boolean)
      .slice(0, 20),
    elements: elements,
  };
})()`;

function locatorFor(page: Page, target: Target): Locator {
  if (target.selector) return page.locator(target.selector);
  if (target.role && target.name)
    return page.getByRole(target.role as never, { name: target.name });
  if (target.role) return page.getByRole(target.role as never);
  if (target.name) return page.getByText(target.name);
  throw new Error("Target has no role, name, or selector");
}

async function unique(locator: Locator): Promise<Locator> {
  const count = await locator.count();
  if (count === 0) throw new Error("No element matches the target");
  if (count > 1) throw new Error(`The target matches ${count} elements; it must be unique`);
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
      const count = await locator.count();
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
          await (await unique(locatorFor(page, action.target))).press(action.key);
        } else {
          await page.keyboard.press(action.key);
        }
        return;
      }
      if (action.type === "fill" && "target" in action && action.target) {
        await (await unique(locatorFor(page, action.target))).fill(action.value);
        return;
      }
      if (action.type === "select" && "target" in action && action.target) {
        await (await unique(locatorFor(page, action.target))).selectOption(action.value);
        return;
      }
      if (action.type === "click" && "target" in action && action.target) {
        await (await unique(locatorFor(page, action.target))).click();
        return;
      }
      throw new Error(`Action ${action.type} is not supported by this driver`);
    },
    async waitFor(expect: Expect) {
      await waitForExpectation(page, expect);
    },
    async countMatches(target: Target) {
      return locatorFor(page, target).count();
    },
    async bounds(target: Target) {
      const box = await locatorFor(page, target).first().boundingBox();
      return box ?? undefined;
    },
    async mouseMove(x: number, y: number) {
      await page.mouse.move(x, y);
    },
    async url() {
      return page.url();
    },
    async inspect(): Promise<PageInspection> {
      const raw = (await page.evaluate(INSPECTION_SCRIPT)) as RawInspection;
      const elements: ObservedElement[] = raw.elements.map((element, index) => ({
        ref: `e${index + 1}`,
        role: element.role,
        name: element.name,
        enabled: element.enabled,
        visible: element.visible,
        bounds: element.bounds,
        risk: classifyRisk(element, new URL(raw.url).origin),
        target:
          element.role && element.name
            ? { role: element.role, name: element.name }
            : element.role
              ? { role: element.role }
              : { selector: element.selector },
        selector: element.selector,
      }));
      return {
        url: raw.url,
        title: raw.title,
        scroll: raw.scroll,
        headings: raw.headings,
        elements,
        errors: errors.slice(-20),
      };
    },
    async snapshot() {
      return page.locator("body").ariaSnapshot();
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
