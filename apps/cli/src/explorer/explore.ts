import { relative } from "node:path";
import { chromium } from "playwright";
import { ExplorationArtifactStore, explorationArtifactLimits } from "./artifacts.js";
import { collectInteractiveTargets } from "./interactive-targets.js";
import { capturePageSemanticEvidence } from "./page-observation.js";
import { sanitizeExplorationError, sanitizeExplorationUrl } from "./privacy.js";
import { inspectRepository } from "./repository.js";
import { installSessionStorage, loadSessionStorage } from "./session-storage.js";
import type {
  ExploredControl,
  ExploredPage,
  ExplorationReport,
  ExploreSiteOptions,
} from "./types.js";

const destructivePattern =
  /\b(delete|remove|purchase|buy|pay|publish|send|invite|place order|sign out|log out)\b/i;
const navigationPattern =
  /\b(home|about|pricing|examples?|features?|docs|blog|next|previous|back|menu|open|learn|view)\b/i;
const captchaPattern = /captcha|recaptcha|hcaptcha|challenge-platform|cf-turnstile/i;
const authPattern = /\b(login|log in|sign in|signin|authenticate|password|oauth|unauthorized)\b/i;

function classifyControl(
  role: string,
  name: string,
  tag: string,
  type: string,
): ExploredControl["classification"] {
  if (destructivePattern.test(name)) return "destructive";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || type === "submit") return "form";
  if (role === "link" || navigationPattern.test(name)) return "navigation";
  if (["tab", "menuitem"].includes(role) || /accordion|carousel|expand|collapse/i.test(name))
    return "presentational";
  return "ambiguous";
}

function safeName(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._-]/g, "-").slice(0, 80) || "page";
}

export async function exploreSite(options: ExploreSiteOptions): Promise<ExplorationReport> {
  const maxPages = options.maxPages ?? 10;
  const maxDepth = options.maxDepth ?? 2;
  const sameOriginOnly = options.sameOriginOnly ?? true;
  const target = new URL(options.baseUrl);
  if (!/^https?:$/.test(target.protocol)) throw new Error("Exploration URL must use HTTP or HTTPS");
  const artifacts = new ExplorationArtifactStore(options.outputDirectory);
  await artifacts.initialize(["snapshots", "screenshots", "viewport-screenshots", "diagnostics"]);

  const browser = await chromium.launch({ headless: options.headless ?? true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...(options.storageStatePath ? { storageState: options.storageStatePath } : {}),
  });
  if (options.sessionStoragePath) {
    await installSessionStorage(context, await loadSessionStorage(options.sessionStoragePath));
  }

  const pages: ExploredPage[] = [];
  const queued = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: target.href, depth: 0 }];
  queued.add(target.href.split("#")[0] ?? target.href);
  try {
    while (queue.length > 0 && pages.length < maxPages) {
      const item = queue.shift();
      if (!item) break;
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(`console: ${message.text()}`);
      });
      page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
      try {
        const response = await page.goto(item.url, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await page.waitForTimeout(500);
        if (response && response.status() >= 400) errors.push(`HTTP ${response.status()}`);
        const semantics = await capturePageSemanticEvidence(page);
        const finalUrl = semantics.url;
        const headings = semantics.headings;
        const rawLinks: Array<{ name: string; href: string }> = [];
        const linkLocator = page.locator("a[href]");
        for (let index = 0; index < Math.min(await linkLocator.count(), 200); index += 1) {
          const link = linkLocator.nth(index);
          const href = await link.getAttribute("href");
          const name = (
            (await link.getAttribute("aria-label")) ??
            (await link.getAttribute("title")) ??
            (await link.innerText().catch(() => ""))
          )
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 300);
          if (!href || !name) continue;
          const absolute = new URL(href, finalUrl).href;
          if (/^https?:/.test(absolute)) rawLinks.push({ name, href: absolute });
        }
        const { elements: observedTargets } = await collectInteractiveTargets(page, target.href);
        const html = (await page.content()).slice(0, 2_000_000);
        const hasPasswordField = (await page.locator('input[type="password"]').count()) > 0;
        const hasForm = (await page.locator("form").count()) > 0;
        const artifactStem = `${String(pages.length + 1).padStart(2, "0")}-${safeName(new URL(finalUrl).pathname)}`;
        const screenshotFilename = `${artifactStem}.png`;
        const screenshotArtifact = `screenshots/${screenshotFilename}`;
        const viewportScreenshotArtifact = `viewport-screenshots/${screenshotFilename}`;
        const snapshotArtifact = `snapshots/${artifactStem}.yml`;
        const screenshotAbsolute = artifacts.path(screenshotArtifact);
        await Promise.all([
          page.screenshot({ path: screenshotAbsolute, fullPage: true }),
          page.screenshot({
            path: artifacts.path(viewportScreenshotArtifact),
            fullPage: false,
            scale: "css",
          }),
          artifacts.writeText(
            snapshotArtifact,
            `${semantics.snapshot.trimEnd()}\n`,
            explorationArtifactLimits.snapshotBytes,
          ),
        ]);
        await Promise.all([
          artifacts.assertFileLimit(screenshotArtifact, explorationArtifactLimits.screenshotBytes),
          artifacts.assertFileLimit(
            viewportScreenshotArtifact,
            explorationArtifactLimits.screenshotBytes,
          ),
        ]);
        const links = rawLinks.map((link) => ({
          name: link.name,
          href: sanitizeExplorationUrl(link.href),
          sameOrigin: new URL(link.href).origin === target.origin,
        }));
        const controls = observedTargets
          .filter((element) => !element.href)
          .map((element) => ({
            role: element.role ?? element.tagName.toLowerCase(),
            name: element.name,
            classification: classifyControl(
              element.role ?? "control",
              element.name,
              element.tagName,
              element.inputType ?? "",
            ),
          }));
        const captchaIndicators = [
          ...new Set(
            (html.match(new RegExp(captchaPattern.source, "gi")) ?? []).map((value) =>
              value.toLowerCase(),
            ),
          ),
        ];
        pages.push({
          url: sanitizeExplorationUrl(finalUrl),
          title: await page.title(),
          depth: item.depth,
          headings,
          layers: semantics.layers,
          links,
          controls,
          hasPasswordField,
          hasForm,
          captchaIndicators,
          screenshotPath: relative(options.outputDirectory, screenshotAbsolute),
          viewportScreenshotPath: viewportScreenshotArtifact,
          ariaSnapshotPath: snapshotArtifact,
          errors: errors.slice(0, 50).map(sanitizeExplorationError),
        });
        if (item.depth < maxDepth) {
          for (const link of links) {
            const candidate = new URL(link.href);
            candidate.hash = "";
            if (sameOriginOnly && candidate.origin !== target.origin) continue;
            if (!["http:", "https:"].includes(candidate.protocol) || queued.has(candidate.href))
              continue;
            queued.add(candidate.href);
            queue.push({ url: candidate.href, depth: item.depth + 1 });
          }
        }
      } catch (error) {
        errors.push(
          sanitizeExplorationError(error instanceof Error ? error.message : String(error)),
        );
        pages.push({
          url: item.url,
          title: "",
          depth: item.depth,
          headings: [],
          links: [],
          controls: [],
          hasPasswordField: false,
          hasForm: false,
          captchaIndicators: [],
          screenshotPath: "",
          errors,
        });
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const authEvidence: string[] = [];
  for (const page of pages) {
    if (page.hasPasswordField) authEvidence.push(`Password field on ${page.url}`);
    if (authPattern.test(`${page.url} ${page.title} ${page.headings.join(" ")}`))
      authEvidence.push(`Authentication language on ${page.url}`);
  }
  const captchaDetected = pages.some((page) => page.captchaIndicators.length > 0);
  const loginUrl = pages.find((page) => page.hasPasswordField)?.url;
  const entryPage = pages[0];
  const authenticationRequired = Boolean(
    entryPage?.hasPasswordField ||
    (entryPage &&
      new URL(entryPage.url).origin === target.origin &&
      /auth|login|sign-in|signin/i.test(new URL(entryPage.url).pathname)),
  );
  const repository = options.repositoryPath
    ? await inspectRepository(
        options.repositoryPath,
        options.repositoryHintsPath ? { hintsPath: options.repositoryHintsPath } : {},
      )
    : undefined;
  const report: ExplorationReport = {
    version: 1,
    evidenceVersion: 2,
    id: options.outputDirectory.split(/[\\/]/).pop() ?? "exploration",
    createdAt: new Date().toISOString(),
    target: {
      baseUrl: sanitizeExplorationUrl(target.href),
      ...(options.repositoryPath ? { repositoryPath: options.repositoryPath } : {}),
    },
    limits: { maxPages, maxDepth, sameOriginOnly },
    authentication: {
      detected: authEvidence.length > 0,
      required: authenticationRequired,
      ...(loginUrl ? { loginUrl } : {}),
      captchaDetected,
      evidence: [...new Set(authEvidence)],
      ...(options.authProfile ? { profile: options.authProfile } : {}),
    },
    ...(repository ? { repository } : {}),
    pages,
    risks: [
      ...new Set(
        pages.flatMap((page) =>
          page.controls
            .filter((control) => control.classification === "destructive")
            .map((control) => `Destructive control not used: ${control.name}`),
        ),
      ),
    ],
  };
  await artifacts.writeJson("exploration.json", report);
  await artifacts.writeText("summary.md", explorationSummary(report));
  return report;
}

export function explorationSummary(report: ExplorationReport): string {
  const lines = [
    `# Exploration: ${report.target.baseUrl}`,
    "",
    `Pages inspected: ${report.pages.length}`,
    `Authentication detected: ${report.authentication.detected ? "yes" : "no"}`,
    `Authentication required for entry: ${report.authentication.required ? "yes" : "no"}`,
    `CAPTCHA detected: ${report.authentication.captchaDetected ? "yes" : "no"}`,
    "",
    "## Pages",
    "",
  ];
  for (const page of report.pages) {
    lines.push(
      `### ${page.title || page.url}`,
      "",
      `- URL: ${page.url}`,
      `- Headings: ${page.headings.join("; ") || "none"}`,
      `- Safe navigation links: ${page.links.filter((link) => link.sameOrigin).length}`,
      `- Forms present: ${page.hasForm ? "yes" : "no"}`,
      `- Screenshot: ${page.screenshotPath || "unavailable"}`,
      `- Viewport screenshot: ${page.viewportScreenshotPath || "unavailable"}`,
      `- ARIA snapshot: ${page.ariaSnapshotPath || "unavailable"}`,
      "",
    );
  }
  if (report.risks.length > 0)
    lines.push("## Risks", "", ...report.risks.map((risk) => `- ${risk}`), "");
  return `${lines.join("\n")}\n`;
}
