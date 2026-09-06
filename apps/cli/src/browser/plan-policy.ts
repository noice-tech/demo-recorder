import type { Browser, BrowserContext, Locator, Page } from "playwright";
import type { DemoPlan } from "../demo-plan/index.js";
import {
  attachBlockedInteractionHandlers,
  createGuardedBrowserContext,
} from "../explorer/browser-runtime.js";
import {
  destructiveActionPattern,
  externalEffectPattern,
  formSubmissionPattern,
  mutationActionPattern,
} from "./action-risk.js";

type Constraints = DemoPlan["brief"]["constraints"];
const blockedContexts = new WeakMap<BrowserContext, { failure: Promise<never>; error?: Error }>();
const pageGuards = new WeakMap<Page, Promise<void>>();

/** Shared by rehearsal and capture; no extra observation or settling delay. */
export async function createPlanBrowserContext(
  browser: Browser,
  options: Parameters<typeof createGuardedBrowserContext>[1] & { constraints: Constraints },
): Promise<BrowserContext> {
  let rejectBlocked!: (error: Error) => void;
  const blocked = new Promise<never>((_, reject) => {
    rejectBlocked = reject;
  });
  void blocked.catch(() => undefined);
  const state: { failure: Promise<never>; error?: Error } = { failure: blocked };
  const deny = (reason: string) => {
    state.error ??= new Error(`Blocked by plan safety policy: ${reason}`);
    rejectBlocked(state.error);
  };
  const context = await createGuardedBrowserContext(browser, {
    ...options,
    // CDP below catches every redirect, unlike Playwright's first-request routing.
    // Filtering only document requests also leaves asset loading and caching alone.
    sameOriginOnly: false,
  });
  blockedContexts.set(context, state);
  try {
    context.on("page", (page) => {
      attachBlockedInteractionHandlers(page, {
        onDialog: () => deny("dialog"),
        onPopup: () => deny("popup"),
        onDownload: () => deny("download"),
      });
      const ready = (async () => {
        if (!options.constraints.sameOriginOnly && options.constraints.submitForms) return;
        const session = await context.newCDPSession(page);
        const { frameTree } = await session.send("Page.getFrameTree");
        const origin = new URL(options.baseUrl).origin;
        session.on("Fetch.requestPaused", (event) => {
          const request = event.request;
          const outside =
            options.constraints.sameOriginOnly && new URL(request.url).origin !== origin;
          const submits =
            !options.constraints.submitForms && !["GET", "HEAD"].includes(request.method);
          const denyRequest = event.frameId === frameTree.frame.id && (outside || submits);
          if (denyRequest)
            deny(outside ? "navigation outside the target origin" : "form submission");
          void (
            denyRequest
              ? session.send("Fetch.failRequest", {
                  requestId: event.requestId,
                  errorReason: "Aborted",
                })
              : session.send("Fetch.continueRequest", { requestId: event.requestId })
          ).catch(() => {
            if (!page.isClosed()) deny("navigation guard failed");
          });
        });
        await session.send("Fetch.enable", {
          patterns: [{ resourceType: "Document", requestStage: "Request" }],
        });
      })();
      pageGuards.set(page, ready);
      void ready.catch(() => deny("unable to install navigation guard"));
    });
    await context.exposeBinding("demoRecorderBlockedAction", (_, reason: string) => deny(reason));
    await context.addInitScript((submitForms: boolean) => {
      const browserState = window as unknown as {
        demoRecorderBlockedReason?: string;
        demoRecorderBlockedAction(reason: string): Promise<void>;
      };
      const block = (reason: string) => {
        browserState.demoRecorderBlockedReason = reason;
        void browserState.demoRecorderBlockedAction(reason).catch(() => undefined);
      };
      window.open = () => {
        block("popup");
        return null;
      };
      if (!submitForms)
        document.addEventListener(
          "submit",
          (event) => {
            event.preventDefault();
            event.stopImmediatePropagation();
            block("form submission");
          },
          true,
        );
    }, options.constraints.submitForms);
    return context;
  } catch (error) {
    await context.close();
    throw error;
  }
}

export function assertPlanPolicy(page: Page): void {
  const error = blockedContexts.get(page.context())?.error;
  if (error) throw error;
}

export async function withPlanPolicy(page: Page, action: () => Promise<void>): Promise<void> {
  await pageGuards.get(page);
  const blocked = blockedContexts.get(page.context());
  if (blocked?.error) throw blocked.error;
  if (blocked) {
    await Promise.race([blocked.failure, action()]);
    // Flush synchronous popup/form rejection without a fixed wait or extra observation.
    const reason = await page
      .locator(":root")
      .evaluate(
        () =>
          (window as unknown as { demoRecorderBlockedReason?: string }).demoRecorderBlockedReason,
        undefined,
        { timeout: 3_000 },
      );
    if (reason) throw new Error(`Blocked by plan safety policy: ${reason}`);
    if (blocked.error) throw blocked.error;
  } else await action();
}

/** Check the resolved control, including fallbacks and associated labels. */
export async function assertSafePlanTarget(locator: Locator, plan: DemoPlan): Promise<void> {
  const target = await locator.evaluate((element) => {
    const control = element instanceof HTMLLabelElement ? (element.control ?? element) : element;
    const link = control.closest("a");
    return {
      name: [
        control.getAttribute("aria-label"),
        control.getAttribute("title"),
        control.textContent,
        control.getAttribute("value"),
      ]
        .filter(Boolean)
        .join(" ")
        .slice(0, 1000),
      submits:
        (control instanceof HTMLButtonElement || control instanceof HTMLInputElement) &&
        control.type === "submit" &&
        Boolean(control.form),
      href: link?.href,
      download: link?.hasAttribute("download") ?? false,
      popup: link?.target === "_blank",
    };
  });
  const constraints = plan.brief.constraints;
  let reason: string | undefined;
  if (destructiveActionPattern.test(target.name)) reason = "destructive control";
  else if (target.download || target.popup || externalEffectPattern.test(target.name))
    reason = "external side effect";
  else if (!constraints.submitForms && (target.submits || formSubmissionPattern.test(target.name)))
    reason = "form submission";
  else if (!constraints.modifyData && mutationActionPattern.test(target.name))
    reason = "data modification";
  else if (
    constraints.sameOriginOnly &&
    target.href &&
    new URL(target.href).origin !== new URL(plan.target.baseUrl).origin
  )
    reason = "link outside the target origin";
  if (reason) throw new Error(`Blocked by plan safety policy: ${reason}`);
}
