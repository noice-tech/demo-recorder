import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { startFixtureServer } from "../apps/cli/tests/support/fixture-server.js";

const execute = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const cliRoot = join(repositoryRoot, "apps/cli");
const fixtureDirectory = join(cliRoot, "tests/fixtures/example-app");
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
const remotionIndex = await readFile(join(cliRoot, "assets/remotion/index.html"), "utf8");
if (
  remotionIndex.includes(repositoryRoot) ||
  !remotionIndex.includes('window.remotion_cwd = "";')
) {
  throw new Error("Packaged Remotion index exposes or retains a local repository path");
}

const packOutput = await runNpm(["pack", "--ignore-scripts", "--json"], cliRoot);
const packs = JSON.parse(packOutput) as Array<{
  filename: string;
  files: Array<{ path: string }>;
}>;
const packed = packs[0];
if (!packed) throw new Error("npm pack did not return a package");
const included = new Set(packed.files.map((file) => file.path));
for (const required of ["dist/cli.js", "dist/auth-daemon.js", "assets/remotion/index.html"]) {
  if (!included.has(required)) throw new Error(`Packed package is missing ${required}`);
}
const forbiddenPackagePaths = [
  ".demo-recorder/",
  "recordings/",
  "output/",
  "tests/",
  "fixtures/",
  "assets/remotion/public/",
];
if ([...included].some((path) => forbiddenPackagePaths.some((prefix) => path.startsWith(prefix)))) {
  throw new Error("Packed package contains generated state, tests, fixtures, or Studio media");
}

const tarball = resolve(cliRoot, packed.filename);
const workspace = await mkdtemp(join(tmpdir(), "demo-recorder-package-smoke-"));
try {
  await writeFile(
    join(workspace, "package.json"),
    `${JSON.stringify({ name: "demo-recorder-package-smoke", private: true }, null, 2)}\n`,
  );
  await runNpm(["install", tarball], workspace);
  const version = (await runNpm(["exec", "--", "demo-recorder", "--version"], workspace)).trim();
  if (version !== packageManifest.version)
    throw new Error(`Unexpected packaged CLI version: ${version}`);
  const doctorText = await runNpm(["exec", "--", "demo-recorder", "doctor", "--json"], workspace);
  const doctor = JSON.parse(doctorText) as { status?: string; workspace?: string };
  if (doctor.status !== "ready") throw new Error(`Packaged doctor status: ${doctor.status}`);
  const [reportedWorkspace, expectedWorkspace] = await Promise.all([
    realpath(resolve(doctor.workspace ?? "")),
    realpath(workspace),
  ]);
  if (reportedWorkspace !== expectedWorkspace) {
    throw new Error(`Packaged CLI used the wrong workspace: ${doctor.workspace}`);
  }
  const setupText = await runNpm(["exec", "--", "demo-recorder", "setup", "--json"], workspace);
  const setup = JSON.parse(setupText) as { status?: string };
  if (setup.status !== "ready") throw new Error(`Packaged setup status: ${setup.status}`);
  await runNpm(["exec", "--", "demo-recorder", "inspect-repo", "--repo", "."], workspace);
  const repositoryReport = await stat(join(workspace, ".demo-recorder/repository.json"));
  if (repositoryReport.size === 0) throw new Error("Packaged repository report is empty");

  const fixture = await startFixtureServer(fixtureDirectory);
  try {
    await writeFile(
      join(workspace, "demo-plan.json"),
      `${JSON.stringify(
        {
          version: 1,
          name: "package-smoke",
          brief: {
            goal: "Show a project progressing from creation to launch",
            constraints: { submitForms: false, modifyData: true, sameOriginOnly: true },
          },
          target: { baseUrl: fixture.baseUrl },
          capture: {
            steps: [
              { type: "navigate", url: "/" },
              {
                type: "click",
                locator: {
                  primary: { by: "role", role: "button", name: "Create project" },
                },
              },
              {
                type: "click",
                locator: {
                  primary: { by: "role", role: "button", name: "Approve brief" },
                },
              },
              {
                type: "click",
                locator: {
                  primary: { by: "role", role: "button", name: "Launch project" },
                },
              },
              {
                type: "assert-visible",
                locator: {
                  primary: { by: "text", text: "Project launched", exact: true },
                },
              },
              { type: "hold", durationMs: 300 },
            ],
          },
        },
        null,
        2,
      )}\n`,
    );
    await runNpm(["exec", "--", "demo-recorder", "run", "demo-plan.json"], workspace);
  } finally {
    await fixture.close();
  }

  const outputs = (await readdir(join(workspace, "output"))).filter((name) =>
    name.endsWith(".mp4"),
  );
  if (outputs.length !== 1) throw new Error(`Expected one rendered MP4, found ${outputs.length}`);
  const outputStats = await stat(join(workspace, "output", outputs[0]!));
  if (outputStats.size === 0) throw new Error("Packaged smoke-test MP4 is empty");
  console.log(`[demo-recorder] Packed package smoke test passed: ${basename(tarball)}`);
} finally {
  await Promise.all([
    rm(workspace, { recursive: true, force: true }),
    rm(tarball, { force: true }),
  ]);
}
