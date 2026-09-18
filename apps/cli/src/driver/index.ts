import { cdpDriver } from "./cdp.js";
import { playwrightDriver } from "./playwright.js";
import type { Driver } from "./types.js";

export * from "./types.js";

export const defaultDriverName = "playwright";

export function selectDriver(name: string): Driver {
  if (name === "playwright" || name === "chromium" || name === "playwright-chromium") {
    return playwrightDriver;
  }
  if (name === "cdp" || name === "playwright-cdp") {
    return cdpDriver;
  }
  if (name === "playwriter") {
    throw new Error(
      "The Playwriter extension driver is deferred in this build; it needs the external `playwriter` package and Chrome extension. Use `--driver cdp --target <cdp-url>` to attach, or `--driver playwright` to launch.",
    );
  }
  throw new Error(`Unknown driver "${name}". Available drivers: playwright, cdp`);
}
