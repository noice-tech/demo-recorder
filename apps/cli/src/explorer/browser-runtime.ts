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
