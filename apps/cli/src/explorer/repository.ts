import { readFile, readdir } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import type { RepositoryReport } from "./types.js";

const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".demo-recorder",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "output",
  "recordings",
]);
const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx", ".vue", ".svelte"]);

async function walk(root: string, limit = 5_000): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    if (files.length >= limit) return;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (files.length >= limit) break;
      if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await visit(path);
      } else if (entry.isFile()) files.push(path);
    }
  }
  await visit(root);
  return files;
}

export async function inspectRepository(repositoryPath: string): Promise<RepositoryReport> {
  const root = resolve(repositoryPath);
  const files = await walk(root);
  let packageJson: {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } = {};
  try {
    packageJson = JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    ) as typeof packageJson;
  } catch {
    // Unknown repositories are still useful to inspect by filename.
  }
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  const framework = dependencies.next
    ? "Next.js"
    : dependencies["react-router"] || dependencies["react-router-dom"]
      ? "React Router"
      : dependencies.nuxt
        ? "Nuxt"
        : dependencies.svelte || dependencies["@sveltejs/kit"]
          ? "Svelte"
          : dependencies.vue
            ? "Vue"
            : dependencies.react
              ? "React"
              : undefined;
  const packageManager = files.some((file) => basename(file) === "pnpm-lock.yaml")
    ? "pnpm"
    : files.some((file) => basename(file) === "yarn.lock")
      ? "yarn"
      : files.some((file) => basename(file) === "bun.lockb" || basename(file) === "bun.lock")
        ? "bun"
        : files.some((file) => basename(file) === "package-lock.json")
          ? "npm"
          : undefined;
  const routePattern =
    /(^|\/)(app|pages|routes)\/|route\.(?:js|jsx|ts|tsx)$|router\.(?:js|jsx|ts|tsx)$/;
  const routeFiles = files
    .map((file) => relative(root, file))
    .filter((file) => routePattern.test(file))
    .slice(0, 500);
  const testFiles = files
    .map((file) => relative(root, file))
    .filter((file) => /(?:\.test\.|\.spec\.|playwright)/i.test(file))
    .slice(0, 200);
  const environmentNames = new Set<string>();
  const authHints = new Set<string>();
  for (const file of files) {
    if (!sourceExtensions.has(extname(file)) && basename(file) !== ".env.example") continue;
    const text = await readFile(file, "utf8").catch(() => "");
    if (text.length > 1_000_000) continue;
    for (const match of text.matchAll(/(?:process\.env\.|import\.meta\.env\.)([A-Z][A-Z0-9_]*)/g)) {
      if (match[1]) environmentNames.add(match[1]);
    }
    if (basename(file) === ".env.example") {
      for (const line of text.split("\n")) {
        const match = /^([A-Z][A-Z0-9_]*)=/.exec(line.trim());
        if (match?.[1]) environmentNames.add(match[1]);
      }
    }
    if (
      /\b(auth|login|sign-in|signin|oauth|session|clerk|nextauth|supabase)\b/i.test(
        `${file}\n${text.slice(0, 20_000)}`,
      )
    ) {
      authHints.add(relative(root, file));
    }
  }
  const environmentVariableNames = [...environmentNames];
  // Node 22 target does not expose Array#toSorted in the TypeScript ES2022 library.
  // oxlint-disable-next-line unicorn/no-array-sort
  environmentVariableNames.sort();
  return {
    path: root,
    ...(packageManager ? { packageManager } : {}),
    ...(framework ? { framework } : {}),
    scripts: packageJson.scripts ?? {},
    routeFiles,
    testFiles,
    environmentVariableNames,
    authenticationHints: [...authHints].slice(0, 100),
  };
}
