import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { DemoPlan } from "../demo-plan/index.js";
import { ExplorationArtifactStore, explorationArtifactLimits } from "./artifacts.js";
import {
  attachBlockedInteractionHandlers,
  createGuardedBrowserContext,
  explorationViewport,
  waitForSemanticQuiet,
} from "./browser-runtime.js";
import {
  diffExplorationObservations,
  explorationSemanticFingerprint,
  materializeExplorationGraph,
} from "./graph.js";
import { decideExplorationActionPolicy } from "./interactive-policy.js";
import {
  collectInteractiveTargets,
  refreshInteractiveTarget,
  type ExplorationRefEntry,
} from "./interactive-targets.js";
import { capturePageSemanticEvidence } from "./page-observation.js";
import { exportVerifiedPathToDemoPlan } from "./plan-export.js";
import {
  sanitizeExplorationAction,
  sanitizeExplorationError,
  sanitizeExplorationUrl,
} from "./privacy.js";
import {
  explorationActionSchema,
  explorationDraftPlanRequestSchema,
  explorationFindQuerySchema,
  explorationFindResultSchema,
  explorationObservationSchema,
  explorationTransitionSchema,
  type ExplorationFindResult,
  type ExplorationLaunchConfig,
  type ExplorationObservation,
  type ExplorationSessionReport,
  type ExplorationTransition,
  type ExplorationVerificationReport,
} from "./interactive-schema.js";
import { createExplorationSessionReport, explorationSessionSummary } from "./session-report.js";
import { verifyExplorationPath } from "./verification.js";

type Settled = ExplorationObservation["settled"];

export class InteractiveExplorationSession {
  private browser!: Browser;
  private context!: BrowserContext;
  private page!: Page;
  private createdAt = new Date().toISOString();
  private startedAtMs = Date.now();
  private observationSequence = 0;
  private transitionSequence = 0;
  private actionCount = 0;
  private stateSequence = 0;
  private verificationSequence = 0;
  private currentObservation: ExplorationObservation | undefined;
  private refs = new Map<string, ExplorationRefEntry>();
  private states = new Map<string, string>();
  private observations: ExplorationObservation[] = [];
  private transitions: ExplorationTransition[] = [];
  private verifications: ExplorationVerificationReport[] = [];
  private errors: string[] = [];
  private popupBlocked = false;
  private downloadBlocked = false;
  private dialogDismissed = false;
  private closed = false;
  private readonly artifacts: ExplorationArtifactStore;

  constructor(readonly config: ExplorationLaunchConfig) {
    this.artifacts = new ExplorationArtifactStore(config.outputDirectory);
  }

  async start(): Promise<ExplorationObservation> {
    await this.artifacts.initialize(["observations", "snapshots", "screenshots", "diagnostics"]);
    this.browser = await chromium.launch({ headless: this.config.headless });
    this.context = await createGuardedBrowserContext(this.browser, {
      baseUrl: this.config.baseUrl,
      ...(this.config.storageStatePath ? { storageStatePath: this.config.storageStatePath } : {}),
      ...(this.config.sessionStoragePath
        ? { sessionStoragePath: this.config.sessionStoragePath }
        : {}),
      onBlockedNavigation: (url) =>
        this.errors.push(
          `Blocked cross-origin main-frame navigation to ${sanitizeExplorationUrl(url)}`,
        ),
    });
    await this.context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    this.page = await this.context.newPage();
    this.attachPageEvents(this.page);
    await this.page.goto(this.config.baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const settled = await waitForSemanticQuiet(this.page, { initial: true });
    const observation = await this.observe("initial", settled);
    await this.writeReport("active");
    return observation;
  }

  private attachPageEvents(page: Page): void {
    page.on("console", (message) => {
      if (message.type() === "error")
        this.errors.push(sanitizeExplorationError(`console: ${message.text()}`));
    });
    page.on("pageerror", (error) =>
      this.errors.push(sanitizeExplorationError(`page: ${error.message}`)),
    );
    attachBlockedInteractionHandlers(page, {
      onDialog: () => {
        this.dialogDismissed = true;
      },
      onPopup: () => {
        this.popupBlocked = true;
      },
      onDownload: () => {
        this.downloadBlocked = true;
      },
    });
  }

  private ensureWithinLimits(): void {
    if (this.actionCount >= this.config.maxActions)
      throw new Error(`Exploration action limit reached (${this.config.maxActions})`);
    if (Date.now() - this.startedAtMs >= this.config.maxDurationMs)
      throw new Error(`Exploration duration limit reached (${this.config.maxDurationMs}ms)`);
  }

  async observe(reason = "agent-request", settled?: Settled): Promise<ExplorationObservation> {
    const sequence = ++this.observationSequence;
    const id = `obs-${String(sequence).padStart(4, "0")}`;
    const snapshotArtifact = `snapshots/${id}.yml`;
    const screenshotArtifact = `screenshots/${id}.png`;
    const observationArtifact = `observations/${id}.json`;
    const semantics = await capturePageSemanticEvidence(this.page);
    const { snapshot } = semantics;
    await Promise.all([
      this.artifacts.writeText(
        snapshotArtifact,
        `${snapshot.trimEnd()}\n`,
        explorationArtifactLimits.snapshotBytes,
      ),
      this.artifacts.writeExternalFile(
        screenshotArtifact,
        explorationArtifactLimits.screenshotBytes,
        (path) => this.page.screenshot({ path, fullPage: false, scale: "css" }).then(() => {}),
      ),
    ]);
    const { elements, refs } = await collectInteractiveTargets(this.page, this.config.baseUrl);
    const currentUrl = semantics.url;
    const semanticFingerprint = explorationSemanticFingerprint(
      new URL(currentUrl).pathname,
      snapshot,
    );
    let stateId = this.states.get(semanticFingerprint);
    if (!stateId) {
      stateId = `state-${String(++this.stateSequence).padStart(4, "0")}`;
      this.states.set(semanticFingerprint, stateId);
    }
    const observation = explorationObservationSchema.parse({
      schemaVersion: 2,
      id,
      sequence,
      stateId,
      reason,
      createdAt: new Date().toISOString(),
      url: sanitizeExplorationUrl(currentUrl),
      pathname: semantics.pathname,
      title: semantics.title,
      viewport: explorationViewport,
      scroll: semantics.scroll,
      headings: semantics.headings,
      layers: semantics.layers,
      interactiveElements: elements,
      errors: this.errors.splice(0, 50),
      artifacts: {
        snapshot: snapshotArtifact,
        screenshot: screenshotArtifact,
        observation: observationArtifact,
      },
      semanticFingerprint,
      settled: settled ?? { reason: "explicit", durationMs: 0 },
    });
    await Promise.all([
      this.artifacts.writeJson(observationArtifact, observation),
      this.artifacts.appendJsonLine("observations.ndjson", observation),
    ]);
    this.refs = refs;
    this.currentObservation = observation;
    this.observations.push(observation);
    await this.writeGraph();
    await this.writeReport("active");
    return observation;
  }

  find(input: unknown): ExplorationFindResult {
    const query = explorationFindQuerySchema.parse(input);
    const observation = this.currentObservation;
    if (!observation) throw new Error("Exploration session has no current observation");
    let matchesText: (value: string) => boolean;
    if (query.text) {
      const expected = query.text.toLocaleLowerCase();
      matchesText = (value) => value.toLocaleLowerCase().includes(expected);
    } else {
      const pattern = query.regex;
      if (!pattern) throw new Error("Exploration regex search is missing its pattern");
      let regex: RegExp;
      try {
        regex = new RegExp(pattern);
      } catch (error) {
        throw new Error(`Invalid exploration search regular expression: ${query.regex}`, {
          cause: error,
        });
      }
      matchesText = (value) => regex.test(value);
    }
    const matches: ExplorationFindResult["matches"] = [];
    for (const element of observation.interactiveElements) {
      if (!matchesText(`${element.role ?? ""} ${element.name}`)) continue;
      matches.push({
        kind: "element",
        ref: element.ref,
        ...(element.role ? { role: element.role } : {}),
        text: element.name,
        risk: element.risk,
      });
    }
    for (const heading of observation.headings) {
      if (matchesText(heading)) matches.push({ kind: "heading", role: "heading", text: heading });
    }
    for (const layer of observation.layers) {
      if (matchesText(`${layer.role} ${layer.name}`))
        matches.push({ kind: "layer", role: layer.role, text: layer.name });
    }
    return explorationFindResultSchema.parse({
      observationId: observation.id,
      matches: matches.slice(0, 50),
    });
  }

  async verify(input: unknown): Promise<ExplorationVerificationReport> {
    const verification = await verifyExplorationPath({
      browser: this.browser,
      config: this.config,
      observations: this.observations,
      transitions: this.transitions,
      artifacts: this.artifacts,
      sequence: ++this.verificationSequence,
      input,
    });
    this.verifications.push(verification);
    await this.writeReport("active");
    return verification;
  }

  exportPlan(input: unknown): DemoPlan {
    const request = explorationDraftPlanRequestSchema.parse(input);
    const verification = this.verifications.find(
      (candidate) => candidate.id === request.verificationId,
    );
    if (!verification) throw new Error(`Unknown verification: ${request.verificationId}`);
    return exportVerifiedPathToDemoPlan({
      input: request,
      config: this.config,
      verification,
      transitions: this.transitions,
      observations: this.observations,
    });
  }

  async act(input: unknown): Promise<ExplorationTransition> {
    this.ensureWithinLimits();
    const action = explorationActionSchema.parse(input);
    const before = this.currentObservation;
    if (!before) throw new Error("Exploration session has no current observation");
    let entry = "ref" in action ? this.refs.get(action.ref) : undefined;
    if ("observationId" in action && action.observationId !== before.id)
      throw new Error(
        `Stale observation reference: expected ${before.id}, received ${action.observationId}`,
      );
    if (entry)
      entry = await refreshInteractiveTarget(
        entry,
        this.config.baseUrl,
        this.currentObservation?.id ?? "the last observation",
      );
    this.actionCount += 1;
    const policy = decideExplorationActionPolicy(
      action,
      this.config.policy,
      this.config.baseUrl,
      entry?.element,
    );
    const sequence = ++this.transitionSequence;
    const id = `transition-${String(sequence).padStart(4, "0")}`;
    const startedAt = Date.now();
    this.popupBlocked = false;
    this.downloadBlocked = false;
    this.dialogDismissed = false;

    if (!policy.allowed) {
      const blocked = explorationTransitionSchema.parse({
        schemaVersion: 2,
        id,
        sequence,
        createdAt: new Date().toISOString(),
        action,
        status: "blocked",
        policy,
        fromObservationId: before.id,
        fromStateId: before.stateId,
        ...(entry ? { target: entry.element.target } : {}),
        outcome: {
          urlChanged: false,
          semanticChanged: false,
          popupBlocked: false,
          downloadBlocked: false,
          dialogDismissed: false,
        },
        durationMs: Date.now() - startedAt,
      });
      await this.persistTransition(blocked);
      return blocked;
    }

    try {
      if (action.type === "click") {
        if (!entry) throw new Error(`Unknown element reference: ${action.ref}`);
        if (!entry.element.enabled) throw new Error(`Element ${action.ref} is disabled`);
        await entry.locator.click({ timeout: 5_000 });
      } else if (action.type === "hover") {
        if (!entry) throw new Error(`Unknown element reference: ${action.ref}`);
        await entry.locator.hover({ timeout: 5_000 });
      } else if (action.type === "goto") {
        const destination = new URL(action.url, this.config.baseUrl);
        if (destination.origin !== new URL(this.config.baseUrl).origin)
          throw new Error(
            `Cross-origin navigation is blocked: ${sanitizeExplorationUrl(destination.href)}`,
          );
        await this.page.goto(destination.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
      } else if (action.type === "back") {
        await this.page.goBack({ waitUntil: "domcontentloaded", timeout: 30_000 });
      } else if (action.type === "scroll") {
        await this.page.mouse.wheel(action.deltaX, action.deltaY);
      } else {
        await this.page.waitForTimeout(action.durationMs);
      }
      const settled = await waitForSemanticQuiet(this.page, {
        explicit: action.type === "wait",
      });
      const after = await this.observe(`after-${action.type}`, settled);
      const transition = explorationTransitionSchema.parse({
        schemaVersion: 2,
        id,
        sequence,
        createdAt: new Date().toISOString(),
        action,
        status: "succeeded",
        policy,
        fromObservationId: before.id,
        fromStateId: before.stateId,
        toObservationId: after.id,
        toStateId: after.stateId,
        ...(entry ? { target: entry.element.target } : {}),
        diff: diffExplorationObservations(before, after),
        outcome: {
          urlChanged: before.url !== after.url,
          semanticChanged: before.semanticFingerprint !== after.semanticFingerprint,
          popupBlocked: this.popupBlocked,
          downloadBlocked: this.downloadBlocked,
          dialogDismissed: this.dialogDismissed,
          settledReason: settled.reason === "initial" ? "quiet" : settled.reason,
        },
        durationMs: Date.now() - startedAt,
      });
      await this.persistTransition(transition);
      return transition;
    } catch (error) {
      const transition = explorationTransitionSchema.parse({
        schemaVersion: 2,
        id,
        sequence,
        createdAt: new Date().toISOString(),
        action,
        status: "failed",
        policy,
        fromObservationId: before.id,
        fromStateId: before.stateId,
        ...(entry ? { target: entry.element.target } : {}),
        outcome: {
          urlChanged: before.url !== sanitizeExplorationUrl(this.page.url()),
          semanticChanged: false,
          popupBlocked: this.popupBlocked,
          downloadBlocked: this.downloadBlocked,
          dialogDismissed: this.dialogDismissed,
        },
        durationMs: Date.now() - startedAt,
        error: sanitizeExplorationError(error instanceof Error ? error.message : String(error)),
      });
      await this.persistTransition(transition);
      return transition;
    }
  }

  private async persistTransition(transition: ExplorationTransition): Promise<void> {
    this.transitions.push(transition);
    await this.artifacts.appendJsonLine("transitions.ndjson", {
      ...transition,
      action: sanitizeExplorationAction(transition.action, this.config.baseUrl),
    });
    await this.writeGraph();
    await this.writeReport("active");
  }

  private async writeGraph(): Promise<void> {
    await this.artifacts.writeJson(
      "graph.json",
      materializeExplorationGraph(this.observations, this.transitions),
    );
  }

  report(status: ExplorationSessionReport["status"] = "active"): ExplorationSessionReport {
    return createExplorationSessionReport({
      config: this.config,
      createdAt: this.createdAt,
      status,
      observations: this.observations.length,
      states: this.states.size,
      transitions: this.transitions.length,
      actions: this.actionCount,
      verifications: this.verifications,
      ...(this.currentObservation ? { latestObservation: this.currentObservation } : {}),
    });
  }

  private async writeReport(status: ExplorationSessionReport["status"]): Promise<void> {
    const report = this.report(status);
    await Promise.all([
      this.artifacts.writeJson("exploration.json", report),
      this.artifacts.writeText(
        "summary.md",
        explorationSessionSummary(report, this.currentObservation, this.verifications.at(-1)),
      ),
    ]);
  }

  async close(status: "finished" | "aborted" | "failed" = "finished"): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.writeReport(status).catch(() => undefined);
    if (this.context)
      await this.artifacts
        .writeExternalFile("diagnostics/trace.zip", explorationArtifactLimits.traceBytes, (path) =>
          this.context.tracing.stop({ path }),
        )
        .catch(() => undefined);
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
  }
}
