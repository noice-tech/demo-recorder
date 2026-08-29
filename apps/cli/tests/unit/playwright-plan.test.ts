import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  exportDemoPlanToPlaywright,
  importPlaywrightTest,
  parseDemoPlan,
} from "../../src/demo-plan/index.js";

async function spec(source: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "demo-recorder-playwright-"));
  const path = join(directory, "flow.spec.ts");
  await writeFile(path, source);
  return path;
}

describe("Playwright plan conversion", () => {
  it("imports a common inline Playwright flow", async () => {
    const path = await spec(`
      import { test, expect } from '@playwright/test';
      test('opens settings', async ({ page }) => {
        await page.goto('/');
        const settings = page.getByRole('link', { name: 'Settings', exact: true });
        await settings.click();
        await page.waitForURL('**/settings');
        await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
      });
    `);
    const result = await importPlaywrightTest({
      path,
      baseUrl: "https://example.com",
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.plan?.capture.steps.map((step) => step.type)).toEqual([
      "navigate",
      "click",
      "wait-for-url",
      "assert-visible",
    ]);
    expect(result.plan?.capture.steps[1]).toMatchObject({
      locator: { primary: { by: "role", role: "link", name: "Settings", exact: true } },
    });
  });

  it("returns a focused diagnostic instead of guessing through control flow", async () => {
    const path = await spec(`
      test('conditional flow', async ({ page }) => {
        await page.goto('/');
        if (enabled) await page.getByText('Settings').click();
      });
    `);
    const result = await importPlaywrightTest({ path, baseUrl: "https://example.com" });
    expect(result.plan).toBeUndefined();
    expect(result.diagnostics[0]?.message).toContain("IfStatement");
  });

  it("exports executable-looking Playwright source and omits editorial holds", () => {
    const plan = parseDemoPlan({
      version: 1,
      name: "settings",
      brief: { goal: "Open settings" },
      target: { baseUrl: "https://example.com" },
      capture: {
        steps: [
          { type: "navigate", url: "/" },
          { type: "click", locator: { primary: { by: "text", text: "Settings" } } },
          {
            type: "assert-visible",
            locator: { primary: { by: "role", role: "heading", name: "Settings" } },
          },
          { type: "hold", durationMs: 800 },
        ],
      },
    });
    const result = exportDemoPlanToPlaywright(plan);
    expect(result.source).toContain('page.getByText("Settings").click()');
    expect(result.source).toContain(
      'expect(page.getByRole("heading", { name: "Settings" })).toBeVisible()',
    );
    expect(result.source).not.toContain("waitForTimeout");
    expect(result.warnings).toContain("Editorial hold steps were omitted");
  });
});
