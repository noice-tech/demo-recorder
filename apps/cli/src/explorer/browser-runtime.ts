import type { Browser, BrowserContext, Page } from "playwright";
import { installSessionStorage, loadSessionStorage } from "./session-storage.js";

export const explorationViewport = { width: 1440, height: 900 } as const;

export async function createGuardedBrowserContext(
  browser: Browser,
  options: {
    baseUrl: string;
    storageStatePath?: string;
    sessionStoragePath?: string;
    onBlockedNavigation?: (url: string) => void;
  },
): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: explorationViewport,
    acceptDownloads: false,
    ...(options.storageStatePath ? { storageState: options.storageStatePath } : {}),
  });
  try {
    if (options.sessionStoragePath)
      await installSessionStorage(context, await loadSessionStorage(options.sessionStoragePath));
    const allowedOrigin = new URL(options.baseUrl).origin;
    await context.route("**/*", async (route) => {
      const request = route.request();
      if (
        request.isNavigationRequest() &&
        request.frame().parentFrame() === null &&
        /^https?:/.test(request.url()) &&
        new URL(request.url()).origin !== allowedOrigin
      ) {
        options.onBlockedNavigation?.(request.url());
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });
    return context;
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }
}

export async function performExplorationScroll(
  page: Page,
  deltaY: number,
  deltaX = 0,
): Promise<void> {
  await page.mouse.wheel(deltaX, deltaY);
  // Exploration needs the resulting state, not capture-quality 60 FPS motion.
  await page.waitForTimeout(50);
}

type ExplorationTextQuery = { text: string } | { regex: string };

export async function isExplorationTextVisible(
  page: Page,
  query: ExplorationTextQuery,
): Promise<boolean> {
  return page.evaluate((input) => {
    const regex = "regex" in input ? new RegExp(input.regex) : undefined;
    const expected = "text" in input ? input.text.toLocaleLowerCase() : undefined;
    const matches = (value: string): boolean => {
      const normalized = value.trim().replace(/\s+/g, " ");
      return regex ? regex.test(normalized) : normalized.toLocaleLowerCase().includes(expected!);
    };
    // This helper must remain inside the serialized browser callback.
    // oxlint-disable-next-line unicorn/consistent-function-scoping
    const intersectsViewport = (bounds: DOMRect): boolean =>
      bounds.width > 0 &&
      bounds.height > 0 &&
      bounds.left < window.innerWidth &&
      bounds.right > 0 &&
      bounds.top < window.innerHeight &&
      bounds.bottom > 0;

    for (const element of document.querySelectorAll<HTMLElement>("[aria-label]")) {
      const style = getComputedStyle(element);
      if (
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        matches(element.getAttribute("aria-label") ?? "") &&
        intersectsViewport(element.getBoundingClientRect())
      )
        return true;
    }

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!matches(node.textContent ?? "")) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      const style = getComputedStyle(parent);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      if (intersectsViewport(range.getBoundingClientRect())) return true;
    }
    return false;
  }, query);
}

export async function performExplorationScrollUntil(
  page: Page,
  options: ExplorationTextQuery & {
    direction: "up" | "down";
    stepPx: number;
    maxSteps: number;
  },
): Promise<void> {
  let previousScrollY = await page.evaluate(() => window.scrollY);
  for (let step = 0; step <= options.maxSteps; step += 1) {
    if (await isExplorationTextVisible(page, options)) return;
    if (step === options.maxSteps) break;
    const deltaY = options.direction === "down" ? options.stepPx : -options.stepPx;
    await performExplorationScroll(page, deltaY);
    const scrollY = await page.evaluate(() => window.scrollY);
    if (scrollY === previousScrollY) break;
    previousScrollY = scrollY;
  }
  const description = "text" in options ? JSON.stringify(options.text) : `/${options.regex}/`;
  throw new Error(
    `Could not bring ${description} into the viewport within ${options.maxSteps} scroll steps`,
  );
}

export function attachBlockedInteractionHandlers(
  page: Page,
  handlers: {
    onDialog?: () => void;
    onPopup?: () => void;
    onDownload?: () => void;
  } = {},
): void {
  page.on("dialog", (dialog) => {
    handlers.onDialog?.();
    void dialog.dismiss().catch(() => undefined);
  });
  page.on("popup", (popup) => {
    handlers.onPopup?.();
    void popup.close().catch(() => undefined);
  });
  page.on("download", (download) => {
    handlers.onDownload?.();
    void download.cancel().catch(() => undefined);
  });
}

// Prefer a stable accessibility snapshot over network-idle: modern apps often keep sockets and
// analytics requests open even when the user-visible state has settled.
export async function waitForSemanticQuiet(
  page: Page,
  options: { initial?: boolean; explicit?: boolean } = {},
): Promise<{ reason: "initial" | "quiet" | "timed-out" | "explicit"; durationMs: number }> {
  if (options.explicit) return { reason: "explicit", durationMs: 0 };
  const startedAt = Date.now();
  let previous = "";
  let stableSince = Date.now();
  const timeoutMs = options.initial ? 3_000 : 2_500;
  while (Date.now() - startedAt < timeoutMs) {
    await page.waitForTimeout(100);
    const snapshot = await page.ariaSnapshot({ mode: "default", depth: 8, timeout: 2_000 });
    const normalized = snapshot.replaceAll(/\s+/g, " ").trim();
    if (normalized === previous) {
      if (Date.now() - stableSince >= 250)
        return {
          reason: options.initial ? "initial" : "quiet",
          durationMs: Date.now() - startedAt,
        };
    } else {
      previous = normalized;
      stableSince = Date.now();
    }
  }
  return { reason: "timed-out", durationMs: Date.now() - startedAt };
}
