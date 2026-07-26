import type { Page } from "playwright";

export type PageSemanticEvidence = {
  url: string;
  pathname: string;
  title: string;
  snapshot: string;
  headings: string[];
  layers: Array<{ role: string; name: string }>;
  scroll: { x: number; y: number };
};

export async function capturePageSemanticEvidence(page: Page): Promise<PageSemanticEvidence> {
  const [snapshot, headings, layers, scroll, title] = await Promise.all([
    page.ariaSnapshot({ mode: "ai", depth: 12, timeout: 5_000 }),
    page
      .locator("h1, h2, h3, [role=heading]")
      .evaluateAll((nodes) =>
        nodes
          .filter((node) => {
            const style = getComputedStyle(node);
            const bounds = node.getBoundingClientRect();
            return style.visibility !== "hidden" && style.display !== "none" && bounds.width > 0;
          })
          .map((node) => node.textContent?.trim().replace(/\s+/g, " ").slice(0, 300) ?? "")
          .filter(Boolean)
          .slice(0, 50),
      )
      .catch(() => []),
    page
      .locator('dialog, [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')
      .evaluateAll((nodes) =>
        nodes
          .filter((node) => {
            const style = getComputedStyle(node);
            const bounds = node.getBoundingClientRect();
            return style.visibility !== "hidden" && style.display !== "none" && bounds.width > 0;
          })
          .map((node) => ({
            role:
              node.getAttribute("role") ?? (node instanceof HTMLDialogElement ? "dialog" : "layer"),
            name:
              node.getAttribute("aria-label") ??
              node.textContent?.trim().replace(/\s+/g, " ").slice(0, 200) ??
              "",
          })),
      )
      .catch(() => []),
    page.evaluate(() => ({ x: window.scrollX, y: window.scrollY })),
    page.title(),
  ]);
  const url = page.url();
  return {
    url,
    pathname: new URL(url).pathname,
    title,
    snapshot,
    headings,
    layers,
    scroll,
  };
}
