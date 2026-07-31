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
if (bundle.includes("@remotion/")) {
  throw new Error("Distribution bundle still contains a Remotion import");
}
const packagedNotice = await readFile(join(cliRoot, "THIRD_PARTY_NOTICES.md"), "utf8");
if (/remotion/i.test(packagedNotice)) {
  throw new Error("Packaged third-party notices still reference the legacy renderer");
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
  "dist/auth-daemon.js",
  "dist/exploration-daemon.js",
  "assets/ffmpeg/background.png",
  "assets/ffmpeg/browser-underlay.png",
  "assets/ffmpeg/browser-overlay.png",
  "assets/ffmpeg/content-mask.png",
  "assets/ffmpeg/fonts/Inter-Variable.ttf",
  "assets/ffmpeg/fonts/OFL.txt",
]) {
  if (!included.has(required)) throw new Error(`Packed package is missing ${required}`);
}
const forbiddenPackagePaths = [
  ".demo-recorder/",
  "recordings/",
  "output/",
  "tests/",
  "fixtures/",
  "assets/remotion/",
];
if ([...included].some((path) => forbiddenPackagePaths.some((prefix) => path.startsWith(prefix)))) {
  throw new Error(
    "Packed package contains generated state, tests, fixtures, or legacy renderer assets",
  );
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
  const setupText = await runNpm(
    ["exec", "--", "demo-recorder", "setup", "--chromium", "--json"],
    workspace,
  );
  const setup = JSON.parse(setupText) as { status?: string };
  if (setup.status !== "ready") throw new Error(`Packaged setup status: ${setup.status}`);
  const fixture = await startFixtureServer(fixtureDirectory);
  try {
    const explorationStartText = await runNpm(
      [
        "exec",
        "--",
        "demo-recorder",
        "explore",
        "start",
        "--url",
        fixture.baseUrl,
        "--session",
        "package-smoke",
        "--policy",
        "reversible",
        "--json",
      ],
      workspace,
    );
    const explorationStart = JSON.parse(explorationStartText) as {
      ok?: boolean;
      observation?: { id?: string };
    };
    if (!explorationStart.ok || explorationStart.observation?.id !== "obs-0001")
      throw new Error("Packaged interactive exploration did not start correctly");
    const explorationObserveText = await runNpm(
      ["exec", "--", "demo-recorder", "explore", "observe", "package-smoke", "--json"],
      workspace,
    );
    const explorationObserve = JSON.parse(explorationObserveText) as {
      observation?: {
        id?: string;
        interactiveElements?: Array<{ ref?: string; name?: string }>;
      };
    };
    if (explorationObserve.observation?.id !== "obs-0002")
      throw new Error("Packaged interactive exploration did not preserve its browser session");
    const createProject = explorationObserve.observation.interactiveElements?.find(
      (element) => element.name === "Create project",
    );
    await writeFile(
      join(workspace, "exploration-action.json"),
      `${JSON.stringify({
        type: "click",
        observationId: explorationObserve.observation.id,
        ref: createProject?.ref,
      })}\n`,
    );
    const explorationActionText = await runNpm(
      [
        "exec",
        "--",
        "demo-recorder",
        "explore",
        "act",
        "package-smoke",
        "--input",
        "exploration-action.json",
        "--json",
      ],
      workspace,
    );
    const explorationAction = JSON.parse(explorationActionText) as {
      transition?: { id?: string; status?: string; toObservationId?: string };
      observation?: { id?: string };
    };
    if (
      explorationAction.transition?.status !== "succeeded" ||
      explorationAction.observation?.id !== explorationAction.transition.toObservationId
    )
      throw new Error("Packaged interactive exploration action did not return its observation");
    const explorationCurrentText = await runNpm(
      ["exec", "--", "demo-recorder", "explore", "current", "package-smoke", "--json"],
      workspace,
    );
    const explorationCurrent = JSON.parse(explorationCurrentText) as {
      observation?: { id?: string };
    };
    if (explorationCurrent.observation?.id !== explorationAction.transition?.toObservationId)
      throw new Error("Packaged current exploration command recaptured or lost its observation");
    await writeFile(
      join(workspace, "verification-path.json"),
      `${JSON.stringify({
        version: 1,
        transitionIds: [explorationAction.transition.id],
      })}\n`,
    );
    const verificationText = await runNpm(
      [
        "exec",
        "--",
        "demo-recorder",
        "explore",
        "verify",
        "package-smoke",
        "--input",
        "verification-path.json",
        "--json",
      ],
      workspace,
    );
    const verification = JSON.parse(verificationText) as {
      verification?: { id?: string; status?: string };
    };
    if (verification.verification?.status !== "passed")
      throw new Error("Packaged exploration path verification did not pass");
    await writeFile(
      join(workspace, "draft-request.json"),
      `${JSON.stringify({
        version: 1,
        verificationId: verification.verification.id,
        name: "verified-package-smoke",
        goal: "Replay the verified packaged exploration path",
      })}\n`,
    );
    await runNpm(
      [
        "exec",
        "--",
        "demo-recorder",
        "explore",
        "export-plan",
        "package-smoke",
        "--input",
        "draft-request.json",
        "--output",
        "verified-demo-plan.json",
        "--json",
      ],
      workspace,
    );
    await runNpm(
      ["exec", "--", "demo-recorder", "plan", "validate", "verified-demo-plan.json"],
      workspace,
    );
    const rehearsalText = await runNpm(
      [
        "exec",
        "--",
        "demo-recorder",
        "plan",
        "rehearse",
        "verified-demo-plan.json",
        "--output",
        "verified-rehearsal",
        "--json",
      ],
      workspace,
    );
    const rehearsal = JSON.parse(rehearsalText) as { report?: { status?: string } };
    if (rehearsal.report?.status !== "passed")
      throw new Error("Packaged verified-plan rehearsal did not pass");
    await runNpm(
      ["exec", "--", "demo-recorder", "explore", "finish", "package-smoke", "--json"],
      workspace,
    );

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
