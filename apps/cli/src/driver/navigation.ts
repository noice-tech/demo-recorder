import type { Page, Request } from "playwright";

type NavigationEvent =
  | { kind: "request"; at: number; url: string }
  | { kind: "response"; at: number; url: string; status: number }
  | { kind: "failed"; at: number; url: string; error: string }
  | { kind: "committed"; at: number; url: string };

const MAX_EVENTS = 50;
const NAVIGATION_START_GRACE_MS = 50;

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

function seconds(ms: number): string {
  return `+${(ms / 1000).toFixed(1)}s`;
}

/** Main-frame navigations since the last interaction, to explain a failed `expect`. */
export type NavigationLog = {
  reset(action: string): void;
  /** Waits for a navigation the interaction started to commit. Never fails. */
  settle(timeoutMs: number): Promise<void>;
  /** Empty when nothing navigated and nothing was expected to. */
  describe(expectingNavigation: boolean): string;
};

export function watchNavigation(page: Page): NavigationLog {
  let action = "step";
  let since = Date.now();
  let events: NavigationEvent[] = [];
  const push = (event: NavigationEvent): void => {
    if (events.length < MAX_EVENTS) events.push(event);
  };
  const isMainFrameNavigation = (request: Request): boolean => {
    try {
      return request.isNavigationRequest() && request.frame() === page.mainFrame();
    } catch {
      // Service worker requests have no frame.
      return false;
    }
  };

  page.on("request", (request) => {
    if (isMainFrameNavigation(request))
      push({ kind: "request", at: Date.now(), url: request.url() });
  });
  page.on("response", (response) => {
    const request = response.request();
    if (isMainFrameNavigation(request)) {
      push({ kind: "response", at: Date.now(), url: request.url(), status: response.status() });
    }
  });
  page.on("requestfailed", (request) => {
    if (isMainFrameNavigation(request)) {
      const error = request.failure()?.errorText ?? "failed";
      push({ kind: "failed", at: Date.now(), url: request.url(), error });
    }
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) push({ kind: "committed", at: Date.now(), url: frame.url() });
  });

  const pending = (): boolean => {
    const last = events.filter((event) => event.kind === "request").at(-1);
    return (
      last !== undefined &&
      !events.some(
        (event) => event.at >= last.at && (event.kind === "committed" || event.kind === "failed"),
      )
    );
  };

  return {
    reset(next: string) {
      action = next;
      since = Date.now();
      events = [];
    },
    async settle(timeoutMs: number) {
      const deadline = Date.now() + timeoutMs;
      await sleep(NAVIGATION_START_GRACE_MS);
      while (pending() && Date.now() < deadline) await sleep(50);
    },
    describe(expectingNavigation: boolean) {
      const requests = events.filter((event) => event.kind === "request");
      if (requests.length === 0) {
        // A history API route change commits a new URL without a request.
        const changed = events.find((event) => event.kind === "committed");
        if (changed) {
          return `After the ${action} the page changed its URL to ${changed.url} at ${seconds(changed.at - since)} without loading a new page.`;
        }
        return expectingNavigation ? `No navigation started after the ${action}.` : "";
      }

      const parts: string[] = [];
      for (const request of requests) {
        const later = events.filter((event) => event.at >= request.at && event.url === request.url);
        const response = later.find((event) => event.kind === "response");
        const failed = later.find((event) => event.kind === "failed");
        const outcome = failed
          ? `failed (${failed.error})`
          : response
            ? `answered ${response.status}`
            : "no response";
        parts.push(`${request.url} requested at ${seconds(request.at - since)}, ${outcome}`);
      }
      const last = requests.at(-1)!;
      const committed = events.find((event) => event.kind === "committed" && event.at >= last.at);
      const failed = events.some((event) => event.kind === "failed" && event.at >= last.at);
      const verdict = committed
        ? `The page arrived at ${committed.url} at ${seconds(committed.at - since)}.`
        : failed
          ? "The navigation failed."
          : "The navigation never finished; the site may be slow or blocking automated browsers.";
      return `Navigation after the ${action}: ${parts.join("; ")}. ${verdict}`;
    },
  };
}
