import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const cliRoot = join(repositoryRoot, "apps/cli");
const packageManifest = JSON.parse(await readFile(join(cliRoot, "package.json"), "utf8")) as {
  version: string;
};
const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";

async function runNpm(arguments_: string[], cwd: string): Promise<string> {
  const { stdout, stderr } = await execute(npmExecutable, arguments_, {
    cwd,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (stderr.trim()) process.stderr.write(stderr);
  return stdout;
}

const bundle = await readFile(join(cliRoot, "dist/cli.js"), "utf8");
if (bundle.includes("@noice-tech/demo-recorder-")) {
  throw new Error("Distribution bundle contains unresolved internal workspace imports");
}
if (bundle.includes("@remotion/")) {
  throw new Error("Distribution bundle still contains a Remotion import");
}

const packOutput = await runNpm(["pack", "--ignore-scripts", "--json"], cliRoot);
const packs = JSON.parse(packOutput) as Array<{
  filename: string;
  files: Array<{ path: string }>;
}>;
const packed = packs[0];
if (!packed) throw new Error("npm pack did not return a package");

const included = new Set(packed.files.map((file) => file.path));
for (const required of [
  "dist/cli.js",
  "assets/ffmpeg/browser-underlay.png",
  "assets/ffmpeg/browser-overlay.png",
  "assets/ffmpeg/content-mask.png",
  "assets/ffmpeg/fonts/Inter-Variable.ttf",
  "assets/ffmpeg/fonts/OFL.txt",
  "LICENSE",
  "README.md",
  "THIRD_PARTY_NOTICES.md",
]) {
  if (!included.has(required)) throw new Error(`Packed package is missing ${required}`);
}

const forbiddenPrefixes = [
  ".demo-recorder/",
  "recordings/",
  "output/",
  "src/",
  "tests/",
  "fixtures/",
];
const forbidden = [...included].find((path) =>
  forbiddenPrefixes.some((prefix) => path.startsWith(prefix)),
);
if (forbidden) throw new Error(`Packed package contains forbidden path ${forbidden}`);

const tarball = resolve(cliRoot, packed.filename);
const workspace = await mkdtemp(join(tmpdir(), "demo-recorder-package-test-"));
try {
  await writeFile(
    join(workspace, "package.json"),
    `${JSON.stringify({ name: "demo-recorder-package-test", private: true }, null, 2)}\n`,
  );
  await runNpm(["install", "--ignore-scripts", tarball], workspace);

  const version = (await runNpm(["exec", "--", "demo-recorder", "--version"], workspace)).trim();
  if (version !== packageManifest.version) {
    throw new Error(`Unexpected packaged CLI version: ${version}`);
  }

  const help = await runNpm(["exec", "--", "demo-recorder", "--help"], workspace);
  if (!help.includes("demo-recorder record") || !help.includes("demo-recorder render")) {
    throw new Error("Packaged CLI did not print the expected help");
  }

  const doctorText = await runNpm(["exec", "--", "demo-recorder", "doctor", "--json"], workspace);
  const doctor = JSON.parse(doctorText) as {
    checks?: Array<{ name?: string; ok?: boolean; detail?: string }>;
  };
  const assetsCheck = doctor.checks?.find((check) => check.name === "ffmpeg-assets");
  if (!assetsCheck?.ok) {
    throw new Error(
      `Packaged CLI could not find renderer assets: ${assetsCheck?.detail ?? "missing check"}`,
    );
  }

  for (const asset of [
    "browser-underlay.png",
    "browser-overlay.png",
    "content-mask.png",
    "fonts/Inter-Variable.ttf",
    "fonts/OFL.txt",
  ]) {
    const assetStats = await stat(
      join(workspace, "node_modules/@noice-tech/demo-recorder/assets/ffmpeg", asset),
    );
    if (!assetStats.isFile() || assetStats.size === 0) {
      throw new Error(`Installed renderer asset is missing or empty: ${asset}`);
    }
  }

  console.log(`[demo-recorder] Packed package test passed: ${basename(tarball)}`);
} finally {
  await Promise.all([
    rm(workspace, { recursive: true, force: true }),
    rm(tarball, { force: true }),
  ]);
}
