import { chromium } from "playwright";
import { createBrowserSession, listPages, selectPage } from "./browser-session.js";
import type { Capability, ConnectOptions, Driver, Session } from "./types.js";

const capabilities: ReadonlySet<Capability> = new Set<Capability>([
  "attach",
  "listPages",
  "authState",
]);

/**
 * Attaches to a Chromium already running with a remote debugging port. It
 * drives the user's browser without owning it and cannot record video.
 */
export const cdpDriver: Driver = {
  name: "playwright-cdp",
  capabilities,
  async listPages(target) {
    const browser = await chromium.connectOverCDP(target, { timeout: 30_000 });
    const context = browser.contexts()[0];
    return context ? listPages(context) : [];
  },
  async connect(options: ConnectOptions): Promise<Session> {
    if (options.mode !== "attached") {
      throw new Error('Driver "playwright-cdp" only supports the "attach" capability');
    }
    if (!options.target) {
      throw new Error('Driver "playwright-cdp" requires a --target CDP endpoint');
    }
    const browser = await chromium.connectOverCDP(options.target, { timeout: 30_000 });
    const context = browser.contexts()[0];
    if (!context) throw new Error("The attached browser has no context to drive");
    const pages = context.pages();
    if (pages.length === 0) throw new Error("The attached browser has no open tabs");
    if (!options.pageId && pages.length > 1) {
      throw new Error(
        "Select a tab with --page; list ids with `explore pages --driver cdp --target <cdp-url>`",
      );
    }
    const page = await selectPage(context, options.pageId);
    return createBrowserSession({
      browser,
      context,
      page,
      target: options.target,
      viewport: options.viewport,
      ownsLifecycle: false,
      capture: false,
      guarded: false,
    });
  },
};
