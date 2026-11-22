import type { BrowserContext, Download, Page, Request } from "playwright";

export type Boundary = {
  readonly blocked: readonly string[];
  /** Allows the origin of `url`, such as where the entry URL redirected. */
  allow(url: string): void;
  dispose(): Promise<void>;
};

const NON_NETWORK_PROTOCOLS = new Set(["about:", "data:", "blob:", "file:", "chrome:"]);
const BLOCKED_WINDOW = "demo-recorder: blocked new window ";

function originOf(value: string): string | undefined {
  try {
    const origin = new URL(value).origin;
    return origin === "null" ? undefined : origin;
  } catch {
    return undefined;
  }
}

// No new windows, but same-tab opens still navigate (playstation.com uses
// window.open(url, "_self")); the route handler still guards where they go.
// The console message reaches the boundary from whichever command is connected.
const WINDOW_OPEN_GUARD = `window.open = function (url, target) {
  if (url && ["_self", "_parent", "_top"].includes(String(target))) {
    try { window.location.assign(String(url)); } catch (error) {}
  } else {
    console.debug(${JSON.stringify(BLOCKED_WINDOW)} + (url || "about:blank"));
  }
  return null;
};`;

function isTopLevel(request: Request): boolean {
  try {
    return request.frame().parentFrame() === null;
  } catch {
    // Service worker requests have no frame.
    return false;
  }
}

/**
 * Runtime effect boundary. It only aborts the agreed effects (top-level
 * navigation outside the allowed origins, form submits, popups, and downloads)
 * and never re-classifies risk. The executor policy remains the single safety
 * decision.
 */
export async function enableBoundary(
  context: BrowserContext,
  ownedPage: Page,
  allowedOrigins: readonly string[],
): Promise<Boundary> {
  const blocked: string[] = [];
  const allowed = new Set(
    allowedOrigins.map(originOf).filter((origin): origin is string => origin !== undefined),
  );

  await context.route("**/*", (route) => {
    const request = route.request();
    const url = request.url();
    const protocol = /^[a-z][\w+.-]*:/i.exec(url)?.[0].toLowerCase() ?? "";
    if (!request.isNavigationRequest() || NON_NETWORK_PROTOCOLS.has(protocol)) {
      void route.continue().catch(() => undefined);
      return;
    }
    if (request.method() !== "GET") {
      blocked.push(`form submit ${request.method()} ${url}`);
      void route.abort("blockedbyclient").catch(() => undefined);
      return;
    }
    // Embedded frames (videos, maps, payment widgets) may load from anywhere.
    const origin = originOf(url);
    if (origin && !allowed.has(origin) && isTopLevel(request)) {
      blocked.push(`off-origin navigation ${url}; add ${origin} to allowedOrigins to allow it`);
      void route.abort("blockedbyclient").catch(() => undefined);
      return;
    }
    void route.continue().catch(() => undefined);
  });

  const onPage = (page: Page): void => {
    if (page === ownedPage) {
      return;
    }
    blocked.push(`popup ${page.url()}`);
    void page.close().catch(() => undefined);
  };
  context.on("page", onPage);

  const onDownload = (download: Download): void => {
    blocked.push(`download ${download.url()}`);
    void download.cancel().catch(() => undefined);
  };
  ownedPage.on("download", onDownload);

  const onConsole = (message: { text(): string }): void => {
    const text = message.text();
    if (text.startsWith(BLOCKED_WINDOW)) {
      blocked.push(`new window ${text.slice(BLOCKED_WINDOW.length)}`);
    }
  };
  context.on("console", onConsole);

  await context.addInitScript({ content: WINDOW_OPEN_GUARD });

  return {
    blocked,
    allow(url: string) {
      const origin = originOf(url);
      if (origin) {
        allowed.add(origin);
      }
    },
    async dispose() {
      await context.unroute("**/*").catch(() => undefined);
      context.off("page", onPage);
      context.off("console", onConsole);
      ownedPage.off("download", onDownload);
    },
  };
}
