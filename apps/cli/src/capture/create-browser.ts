import { chromium, type Browser, type BrowserContext } from "playwright";
import type { RecordingSessionOptions } from "./types.js";
import { createPlanBrowserContext } from "../browser/plan-policy.js";
import { installSessionStorage, loadSessionStorage } from "../explorer/session-storage.js";

export type RecordingBrowser = {
  browser: Browser;
  context: BrowserContext;
};

export async function createRecordingBrowser(
  options: RecordingSessionOptions,
): Promise<RecordingBrowser> {
  let browser: Browser;
  try {
    browser = await chromium.launch({ headless: options.headless ?? true });
  } catch (error) {
    throw new Error(
      "Unable to launch Chromium. Run `pnpm exec playwright install chromium` first.",
      { cause: error },
    );
  }

  try {
    const context =
      options.baseUrl && options.plan
        ? await createPlanBrowserContext(browser, {
            ...options,
            baseUrl: options.baseUrl,
            constraints: options.plan.brief.constraints,
          })
        : await browser.newContext({
            viewport: options.viewport,
            ...(options.storageStatePath ? { storageState: options.storageStatePath } : {}),
          });
    if (options.sessionStoragePath && !options.plan)
      await installSessionStorage(context, await loadSessionStorage(options.sessionStoragePath));
    await context.addInitScript(() => {
      // This function must remain inside the serialized browser init script.
      // oxlint-disable-next-line unicorn/consistent-function-scoping
      const hideCursor = () => {
        const style = document.createElement("style");
        style.dataset.demoVideoCursor = "hidden";
        style.textContent = "*, *::before, *::after { cursor: none !important; }";
        (document.head ?? document.documentElement).append(style);
      };
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", hideCursor, { once: true });
      } else {
        hideCursor();
      }
    });
    return { browser, context };
  } catch (error) {
    await browser.close();
    throw new Error("Unable to create the recording browser context", { cause: error });
  }
}
