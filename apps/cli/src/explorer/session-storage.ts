import { readFile } from "node:fs/promises";
import type { BrowserContext } from "playwright";

export type SessionStorageState = Record<string, Record<string, string>>;

export async function loadSessionStorage(path: string): Promise<SessionStorageState> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as SessionStorageState;
  } catch (error) {
    throw new Error(`Unable to load session storage: ${path}`, { cause: error });
  }
}

export async function installSessionStorage(
  context: BrowserContext,
  state: SessionStorageState,
): Promise<void> {
  await context.addInitScript((saved: SessionStorageState) => {
    const values = saved[window.location.origin];
    if (!values) return;
    for (const [key, value] of Object.entries(values)) window.sessionStorage.setItem(key, value);
  }, state);
}

export async function captureSessionStorage(context: BrowserContext): Promise<SessionStorageState> {
  const state: SessionStorageState = {};
  for (const page of context.pages()) {
    if (!/^https?:/.test(page.url())) continue;
    const entry = await page
      .evaluate(() => Object.fromEntries(Object.entries(window.sessionStorage)))
      .catch(() => undefined);
    if (entry) state[new URL(page.url()).origin] = entry;
  }
  return state;
}
