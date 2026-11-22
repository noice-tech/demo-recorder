import type { SnapshotElement } from "./types.js";

const ICON_GLYPHS = /[\uE000-\uF8FF]\s*|\s*[\uE000-\uF8FF]/gu;

/** Drops icon-font glyphs (Unicode private use), which read as noise in names like "\ue600PS5". */
export function withoutIconGlyphs(text: string): string {
  return text.replace(ICON_GLYPHS, "");
}

/**
 * An element with a ref, its position in the tree (child indices from the root),
 * and its named ancestors (nearest first).
 */
export type SnapshotEntry = SnapshotElement & {
  scopes: Array<{ role: string; name: string }>;
};

type AriaNode = { role?: unknown; name?: unknown; ref?: unknown; children?: unknown };

function isNode(value: unknown): value is AriaNode {
  return typeof value === "object" && value !== null;
}

/**
 * Flattens Playwright's `ariaSnapshotJSON({ mode: "ai" })` tree into the elements
 * that carry a ref. Text children (plain strings) are skipped.
 */
export function snapshotEntries(tree: unknown): SnapshotEntry[] {
  const entries: SnapshotEntry[] = [];
  const visit = (value: unknown, path: number[], scopes: SnapshotEntry["scopes"]): void => {
    if (Array.isArray(value)) {
      for (const [index, child] of value.entries()) visit(child, [...path, index], scopes);
      return;
    }
    if (!isNode(value)) return;
    const role = typeof value.role === "string" ? value.role : undefined;
    const name =
      typeof value.name === "string" ? withoutIconGlyphs(value.name) || undefined : undefined;
    if (role && typeof value.ref === "string") {
      entries.push({ ref: value.ref, role, ...(name ? { name } : {}), path, scopes });
    }
    const childScopes = role && name ? [{ role, name }, ...scopes] : scopes;
    visit(value.children, path, childScopes);
  };
  visit(tree, [], []);
  return entries;
}
