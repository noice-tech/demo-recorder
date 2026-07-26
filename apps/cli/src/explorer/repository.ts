import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { RepositoryInspectionOptions, RepositoryReport } from "./types.js";

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
const hintsSchema = z.object({
  version: z.literal(1),
  routes: z.array(z.string().trim().min(1).max(500)).max(200).default([]),
  tests: z.array(z.string().trim().min(1).max(500)).max(200).default([]),
  authentication: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  notes: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
});

const defaultLimits = {
  maxFiles: 5_000,
  maxEntries: 50_000,
  maxTotalBytes: 20 * 1024 * 1024,
  maxFileBytes: 1024 * 1024,
  readConcurrency: 8,
};

type ScanMetrics = RepositoryReport["scan"];

type ReadCandidate = { path: string; size: number };

type PackageMetadata = {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function detectFramework(dependencies: Record<string, string>): string | undefined {
  if (dependencies.next) return "Next.js";
  if (dependencies["react-router"] || dependencies["react-router-dom"]) return "React Router";
  if (dependencies.nuxt) return "Nuxt";
  if (dependencies.svelte || dependencies["@sveltejs/kit"]) return "Svelte";
  if (dependencies.vue) return "Vue";
  if (dependencies.react) return "React";
  return undefined;
}

function detectPackageManager(files: string[]): string | undefined {
  const names = new Set(files.map((file) => basename(file)));
  if (names.has("pnpm-lock.yaml")) return "pnpm";
  if (names.has("yarn.lock")) return "yarn";
  if (names.has("bun.lockb") || names.has("bun.lock")) return "bun";
  if (names.has("package-lock.json")) return "npm";
  return undefined;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < minimum || result > maximum)
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`);
  return result;
}

async function walk(root: string, metrics: ScanMetrics): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    if (
      files.length >= metrics.limits.maxFiles ||
      metrics.entriesVisited >= metrics.limits.maxEntries
    ) {
      metrics.truncated = true;
      return;
    }
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => {
      metrics.errors += 1;
      return [];
    });
    for (const entry of entries) {
      if (
        files.length >= metrics.limits.maxFiles ||
        metrics.entriesVisited >= metrics.limits.maxEntries
      ) {
        metrics.truncated = true;
        break;
      }
      metrics.entriesVisited += 1;
      if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        metrics.skippedSymlinks += 1;
        continue;
      }
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await visit(path);
      } else if (entry.isFile()) files.push(path);
    }
  }
  await visit(root);
  metrics.candidateFiles = files.length;
  return files;
}

function isReadableCandidate(path: string): boolean {
  const name = basename(path);
  return sourceExtensions.has(extname(path)) || name === ".env.example" || name === "package.json";
}

async function selectReadCandidates(
  files: string[],
  metrics: ScanMetrics,
): Promise<ReadCandidate[]> {
  const selected: ReadCandidate[] = [];
  let selectedBytes = 0;
  for (const path of files) {
    if (!isReadableCandidate(path)) continue;
    const metadata = await lstat(path).catch(() => {
      metrics.errors += 1;
      return undefined;
    });
    if (!metadata) continue;
    if (metadata.isSymbolicLink()) {
      metrics.skippedSymlinks += 1;
      continue;
    }
    if (!metadata.isFile()) continue;
    if (metadata.size > metrics.limits.maxFileBytes) {
      metrics.skippedLargeFiles += 1;
      metrics.truncated = true;
      continue;
    }
    if (selectedBytes + metadata.size > metrics.limits.maxTotalBytes) {
      metrics.truncated = true;
      continue;
    }
    selected.push({ path, size: metadata.size });
    selectedBytes += metadata.size;
  }
  metrics.filesSelected = selected.length;
  return selected;
}

async function readConcurrently(
  candidates: ReadCandidate[],
  concurrency: number,
  metrics: ScanMetrics,
): Promise<Map<string, string>> {
  const contents = new Map<string, string>();
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < candidates.length) {
      const index = nextIndex++;
      const candidate = candidates[index];
      if (!candidate) return;
      try {
        const value = await readFile(candidate.path);
        metrics.filesRead += 1;
        metrics.bytesRead += value.byteLength;
        contents.set(candidate.path, value.toString("utf8"));
      } catch {
        metrics.errors += 1;
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, candidates.length) }, () => worker()),
  );
  return contents;
}

async function readHints(
  root: string,
  hintsPath: string | undefined,
  metrics: ScanMetrics,
): Promise<RepositoryReport["advisoryHints"]> {
  if (!hintsPath) return undefined;
  const absolutePath = resolve(root, hintsPath);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${sep}`))
    throw new Error(`Repository hints file must stay inside the repository: ${hintsPath}`);
  const metadata = await lstat(absolutePath).catch(() => undefined);
  if (!metadata) throw new Error(`Repository hints file does not exist: ${absolutePath}`);
  if (metadata.isSymbolicLink())
    throw new Error(`Repository hints file cannot be a symbolic link: ${absolutePath}`);
  if (!metadata.isFile() || metadata.size > 256 * 1024)
    throw new Error(`Repository hints file must be a regular file no larger than 256 KiB`);
  if (metrics.bytesRead + metadata.size > metrics.limits.maxTotalBytes) {
    metrics.truncated = true;
    throw new Error(`Repository hints file exceeds the remaining repository byte budget`);
  }
  const value = await readFile(absolutePath, "utf8");
  metrics.filesRead += 1;
  metrics.bytesRead += Buffer.byteLength(value);
  const hints = hintsSchema.parse(JSON.parse(value) as unknown);
  return {
    source: relative(root, absolutePath) || basename(absolutePath),
    routes: hints.routes,
    tests: hints.tests,
    authentication: hints.authentication,
    notes: hints.notes,
  };
}

export async function inspectRepository(
  repositoryPath: string,
  options: RepositoryInspectionOptions = {},
): Promise<RepositoryReport> {
  const root = resolve(repositoryPath);
  const rootMetadata = await lstat(root).catch(() => undefined);
  if (!rootMetadata?.isDirectory() || rootMetadata.isSymbolicLink())
    throw new Error(`Repository path must be a real directory: ${root}`);
  const limits = {
    maxFiles: boundedInteger(options.maxFiles, defaultLimits.maxFiles, 1, 100_000, "maxFiles"),
    maxEntries: boundedInteger(
      options.maxEntries,
      defaultLimits.maxEntries,
      1,
      1_000_000,
      "maxEntries",
    ),
    maxTotalBytes: boundedInteger(
      options.maxTotalBytes,
      defaultLimits.maxTotalBytes,
      1,
      1024 * 1024 * 1024,
      "maxTotalBytes",
    ),
    maxFileBytes: boundedInteger(
      options.maxFileBytes,
      defaultLimits.maxFileBytes,
      1,
      100 * 1024 * 1024,
      "maxFileBytes",
    ),
    readConcurrency: boundedInteger(
      options.readConcurrency,
      defaultLimits.readConcurrency,
      1,
      32,
      "readConcurrency",
    ),
  };
  const scan: ScanMetrics = {
    limits,
    entriesVisited: 0,
    candidateFiles: 0,
    filesSelected: 0,
    filesRead: 0,
    bytesRead: 0,
    skippedLargeFiles: 0,
    skippedSymlinks: 0,
    errors: 0,
    truncated: false,
  };
  const files = await walk(root, scan);
  const candidates = await selectReadCandidates(files, scan);
  const contents = await readConcurrently(candidates, limits.readConcurrency, scan);
  let packageJson: PackageMetadata = {};
  const packageText = contents.get(join(root, "package.json"));
  if (packageText) {
    try {
      packageJson = JSON.parse(packageText) as typeof packageJson;
    } catch {
      scan.errors += 1;
    }
  }
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  const framework = detectFramework(dependencies);
  const packageManager = detectPackageManager(files);
  const relativeFiles = files.map((file) => relative(root, file));
  const routePattern =
    /(^|\/)(app|pages|routes)\/|route\.(?:js|jsx|ts|tsx)$|router\.(?:js|jsx|ts|tsx)$/;
  const routeFiles = relativeFiles.filter((file) => routePattern.test(file)).slice(0, 500);
  const testFiles = relativeFiles
    .filter((file) => /(?:\.test\.|\.spec\.|playwright)/i.test(file))
    .slice(0, 200);
  const environmentNames = new Set<string>();
  const authHints = new Set<string>();
  for (const [file, text] of contents) {
    if (basename(file) === "package.json") continue;
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
    )
      authHints.add(relative(root, file));
  }
  const environmentVariableNames = [...environmentNames];
  // Node 22 target does not expose Array#toSorted in the TypeScript ES2022 library.
  // oxlint-disable-next-line unicorn/no-array-sort
  environmentVariableNames.sort();
  const advisoryHints = await readHints(root, options.hintsPath, scan);
  return {
    path: root,
    ...(packageManager ? { packageManager } : {}),
    ...(framework ? { framework } : {}),
    scripts: packageJson.scripts ?? {},
    routeFiles,
    testFiles,
    environmentVariableNames,
    authenticationHints: [...authHints].slice(0, 100),
    ...(advisoryHints ? { advisoryHints } : {}),
    scan,
  };
}
