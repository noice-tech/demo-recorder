import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { chromium } from "playwright";
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
  await mkdir(join(options.outputDirectory, "screenshots"), { recursive: true });
  await mkdir(join(options.outputDirectory, "diagnostics"), { recursive: true });

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
        const finalUrl = page.url();
        const headings: string[] = [];
        const headingLocator = page.locator("h1, h2, h3, [role=heading]");
        for (let index = 0; index < Math.min(await headingLocator.count(), 50); index += 1) {
          const text = (
            await headingLocator
              .nth(index)
              .innerText()
              .catch(() => "")
          )
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 300);
          if (text) headings.push(text);
        }
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
        const rawControls: Array<{ role: string; name: string; tag: string; type: string }> = [];
        const controlLocator = page.locator(
          "button, input, textarea, select, [role=button], [role=tab], [role=menuitem]",
        );
        for (let index = 0; index < Math.min(await controlLocator.count(), 200); index += 1) {
          const control = controlLocator.nth(index);
          const tag = await control.evaluate((element) => element.tagName);
          const type = (await control.getAttribute("type")) ?? "";
          const name = (
            (await control.getAttribute("aria-label")) ??
            (await control.getAttribute("title")) ??
            (await control.getAttribute("placeholder")) ??
            (await control.innerText().catch(() => ""))
          )
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 300);
          if (!name) continue;
          const implicitRole =
            tag === "BUTTON"
              ? "button"
              : tag === "INPUT" || tag === "TEXTAREA"
                ? "textbox"
                : tag === "SELECT"
                  ? "combobox"
                  : "control";
          rawControls.push({
            role: (await control.getAttribute("role")) ?? implicitRole,
            name,
            tag,
            type,
          });
        }
        const html = (await page.content()).slice(0, 2_000_000);
        const hasPasswordField = (await page.locator('input[type="password"]').count()) > 0;
        const hasForm = (await page.locator("form").count()) > 0;
        const screenshotFilename = `${String(pages.length + 1).padStart(2, "0")}-${safeName(new URL(finalUrl).pathname)}.png`;
        const screenshotAbsolute = join(options.outputDirectory, "screenshots", screenshotFilename);
        await page.screenshot({ path: screenshotAbsolute, fullPage: true });
        const links = rawLinks.map((link) => ({
          ...link,
          sameOrigin: new URL(link.href).origin === target.origin,
        }));
        const controls = rawControls.map((control) => ({
          role: control.role,
          name: control.name,
          classification: classifyControl(control.role, control.name, control.tag, control.type),
        }));
        const captchaIndicators = [
          ...new Set(
            (html.match(new RegExp(captchaPattern.source, "gi")) ?? []).map((value) =>
              value.toLowerCase(),
            ),
          ),
        ];
        pages.push({
          url: finalUrl,
          title: await page.title(),
          depth: item.depth,
          headings,
          links,
          controls,
          hasPasswordField,
          hasForm,
          captchaIndicators,
          screenshotPath: relative(options.outputDirectory, screenshotAbsolute),
          errors: errors.slice(0, 50),
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
        errors.push(error instanceof Error ? error.message : String(error));
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
    ? await inspectRepository(options.repositoryPath)
    : undefined;
  const report: ExplorationReport = {
    version: 1,
    id: options.outputDirectory.split(/[\\/]/).pop() ?? "exploration",
    createdAt: new Date().toISOString(),
    target: {
      baseUrl: target.href,
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
  await writeFile(
    join(options.outputDirectory, "exploration.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(join(options.outputDirectory, "summary.md"), explorationSummary(report));
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
      "",
    );
  }
  if (report.risks.length > 0)
    lines.push("## Risks", "", ...report.risks.map((risk) => `- ${risk}`), "");
  return `${lines.join("\n")}\n`;
}
