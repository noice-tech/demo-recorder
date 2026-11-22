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
      for (const [index, child] of value.entries()) {
        visit(child, [...path, index], scopes);
      }
      return;
    }
    if (!isNode(value)) {
      return;
    }
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

const OUTLINE_ROLES = new Set([
  "heading",
  "button",
  "link",
  "radio",
  "checkbox",
  "switch",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "combobox",
  "textbox",
  "searchbox",
  "spinbutton",
  "slider",
  "iframe",
  "status",
  "alert",
]);
/** Containers worth showing when named, so a control's place stays readable. */
const NAMED_CONTAINERS = new Set([
  "dialog",
  "alertdialog",
  "region",
  "navigation",
  "form",
  "group",
  "radiogroup",
  "tabpanel",
  "listbox",
  "menu",
]);

/**
 * The snapshot reduced to what the agent acts on: headings, controls, clickable
 * elements, and named containers, nested as in the page. Text, wrappers, and
 * link URLs stay in the full snapshot file.
 */
export function outlineOf(snapshot: string): string {
  const kept: { depth: number; text: string }[] = [];
  const open: number[] = [];
  for (const line of snapshot.split("\n")) {
    const match = /^(\s*)- ([\w-]+)?(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    const [, indent = "", role = "", rest = ""] = match;
    // Any line at or above a kept element's depth ends that element's subtree.
    while (open.length > 0 && (open.at(-1) ?? 0) >= indent.length) {
      open.pop();
    }
    const keep =
      OUTLINE_ROLES.has(role) ||
      (rest.startsWith(' "') && NAMED_CONTAINERS.has(role)) ||
      rest.includes("[cursor=pointer]");
    if (!keep) {
      continue;
    }
    kept.push({ depth: open.length, text: `- ${role}${rest.replace(/:$/, "")}` });
    open.push(indent.length);
  }
  return kept
    .map((entry, index) => {
      const parent = (kept[index + 1]?.depth ?? 0) > entry.depth ? ":" : "";
      return `${"  ".repeat(entry.depth)}${entry.text}${parent}`;
    })
    .join("\n");
}
