import { mkdir, readFile } from "node:fs/promises";
import { chromium, type Browser, type BrowserContext } from "playwright";
import type { RecordingSessionOptions } from "./types.js";

export type RecordingBrowser = {
  browser: Browser;
  context: BrowserContext;
};

export async function createRecordingBrowser(
  options: RecordingSessionOptions,
  videoDirectory: string,
): Promise<RecordingBrowser> {
  await mkdir(videoDirectory, { recursive: true });

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
    const context = await browser.newContext({
      viewport: options.viewport,
      recordVideo: { dir: videoDirectory, size: options.viewport },
      ...(options.storageStatePath ? { storageState: options.storageStatePath } : {}),
    });
    if (options.sessionStoragePath) {
      const sessionState = JSON.parse(await readFile(options.sessionStoragePath, "utf8")) as Record<
        string,
        Record<string, string>
      >;
      await context.addInitScript((state: Record<string, Record<string, string>>) => {
        const values = state[window.location.origin];
        if (!values) return;
        for (const [key, value] of Object.entries(values)) {
          window.sessionStorage.setItem(key, value);
        }
      }, sessionState);
    }
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
