import type { BrowserContext, Download, Page, Request } from "playwright";

export type Boundary = {
  readonly active: boolean;
  readonly blocked: readonly string[];
  dispose(): Promise<void>;
};

const NON_NETWORK_PROTOCOLS = new Set(["about:", "data:", "blob:", "file:", "chrome:"]);

function originOf(value: string): string | undefined {
  try {
    const origin = new URL(value).origin;
    return origin === "null" ? undefined : origin;
  } catch {
    return undefined;
  }
}

function frameOrigin(request: Request): string | undefined {
  try {
    return originOf(request.frame().url());
  } catch {
    return undefined;
  }
}

/**
 * Runtime effect boundary. It only aborts the agreed effects — off-origin
 * document navigation, form submits, popups, and downloads — and never
 * re-classifies risk. The executor policy remains the single safety decision.
 */
export async function enableBoundary(context: BrowserContext, ownedPage: Page): Promise<Boundary> {
  const blocked: string[] = [];
  let allowedOrigin: string | undefined;

  await context.route("**/*", (route) => {
    const request = route.request();
    if (!request.isNavigationRequest()) {
      void route.continue().catch(() => undefined);
      return;
    }
    let protocol = "";
    let targetOrigin: string | undefined;
    try {
      const url = new URL(request.url());
      protocol = url.protocol;
      targetOrigin = originOf(request.url());
    } catch {
      protocol = "";
    }
    if (NON_NETWORK_PROTOCOLS.has(protocol)) {
      void route.continue().catch(() => undefined);
      return;
    }
    if (request.method() !== "GET") {
      blocked.push(`form submit ${request.method()} ${request.url()}`);
      void route.abort("blockedbyclient").catch(() => undefined);
      return;
    }
    if (!allowedOrigin) {
      allowedOrigin = targetOrigin ?? frameOrigin(request);
      void route.continue().catch(() => undefined);
      return;
    }
    if (targetOrigin && targetOrigin !== allowedOrigin) {
      blocked.push(`off-origin navigation ${request.url()}`);
      void route.abort("blockedbyclient").catch(() => undefined);
      return;
    }
    void route.continue().catch(() => undefined);
  });

  const onPage = (page: Page): void => {
    if (page === ownedPage) return;
    blocked.push(`popup ${page.url()}`);
    void page.close().catch(() => undefined);
  };
  context.on("page", onPage);

  const onDownload = (download: Download): void => {
    blocked.push(`download ${download.url()}`);
    void download.cancel().catch(() => undefined);
  };
  ownedPage.on("download", onDownload);

  await context.addInitScript({
    content: "window.open = function () { return null; };",
  });

  return {
    active: true,
    blocked,
    async dispose() {
      await context.unroute("**/*").catch(() => undefined);
      context.off("page", onPage);
      ownedPage.off("download", onDownload);
    },
  };
}
