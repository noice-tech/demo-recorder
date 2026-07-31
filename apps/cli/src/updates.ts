import type { ParsedArguments } from "./arguments.js";
import { cliVersion } from "./version.js";

const releaseManifestUrl =
  "https://raw.githubusercontent.com/noice-tech/demo-recorder/main/release-manifest.json";
const expectedSkill = "demo-video";
const expectedPackage = "@noice-tech/demo-recorder";

type ReleaseManifest = {
  schemaVersion: 1;
  channel: "stable";
  version: string;
  skill: {
    name: string;
    repository: string;
    tag: string;
  };
  runtime: {
    package: string;
    version: string;
  };
  requirements: {
    node: string;
  };
  releaseNotes: string;
};

type UpdateStatus = "current" | "available" | "ahead";

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Update manifest ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Update manifest ${label} must be a non-empty string`);
  }
  return value;
}

function parseManifest(value: unknown): ReleaseManifest {
  const root = record(value, "root");
  const skill = record(root.skill, "skill");
  const runtime = record(root.runtime, "runtime");
  const requirements = record(root.requirements, "requirements");
  const version = text(root.version, "version");
  const runtimeVersion = text(runtime.version, "runtime.version");
  const skillName = text(skill.name, "skill.name");
  const runtimePackage = text(runtime.package, "runtime.package");
  const releaseNotes = text(root.releaseNotes, "releaseNotes");

  if (root.schemaVersion !== 1) throw new Error("Unsupported update manifest schema");
  if (root.channel !== "stable") throw new Error("Update manifest is not the stable channel");
  if (skillName !== expectedSkill)
    throw new Error(`Unexpected skill in update manifest: ${skillName}`);
  if (runtimePackage !== expectedPackage) {
    throw new Error(`Unexpected runtime package in update manifest: ${runtimePackage}`);
  }
  if (runtimeVersion !== version) {
    throw new Error("Skill and runtime versions in the update manifest must match");
  }
  if (text(skill.tag, "skill.tag") !== `v${version}`) {
    throw new Error("Update manifest tag must match its product version");
  }
  if (!releaseNotes.startsWith("https://")) {
    throw new Error("Update manifest releaseNotes must use HTTPS");
  }

  return {
    schemaVersion: 1,
    channel: "stable",
    version,
    skill: {
      name: skillName,
      repository: text(skill.repository, "skill.repository"),
      tag: `v${version}`,
    },
    runtime: { package: runtimePackage, version: runtimeVersion },
    requirements: { node: text(requirements.node, "requirements.node") },
    releaseNotes,
  };
}

function parseSemver(version: string): { core: number[]; prerelease: string[] } {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
  if (!match) throw new Error(`Invalid release version: ${version}`);
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split(".") ?? [],
  };
}

function compareIdentifiers(left: string, right: string): number {
  const leftNumber = /^\d+$/.test(left) ? Number(left) : undefined;
  const rightNumber = /^\d+$/.test(right) ? Number(right) : undefined;
  if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber - rightNumber;
  if (leftNumber !== undefined) return -1;
  if (rightNumber !== undefined) return 1;
  return left.localeCompare(right);
}

function compareSemver(left: string, right: string): number {
  const leftVersion = parseSemver(left);
  const rightVersion = parseSemver(right);
  for (let index = 0; index < leftVersion.core.length; index += 1) {
    const difference = (leftVersion.core[index] ?? 0) - (rightVersion.core[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (leftVersion.prerelease.length === 0) return rightVersion.prerelease.length === 0 ? 0 : 1;
  if (rightVersion.prerelease.length === 0) return -1;
  const length = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = leftVersion.prerelease[index];
    const rightIdentifier = rightVersion.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    const difference = compareIdentifiers(leftIdentifier, rightIdentifier);
    if (difference !== 0) return difference;
  }
  return 0;
}

async function loadManifest(): Promise<ReleaseManifest> {
  const response = await fetch(releaseManifestUrl, {
    headers: { accept: "application/json", "user-agent": `demo-recorder/${cliVersion}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Update manifest request failed with HTTP ${response.status}`);
  return parseManifest(await response.json());
}

export async function updateCommand(arguments_: ParsedArguments): Promise<void> {
  const [operation, ...extra] = arguments_.positionals;
  if (operation !== "check" || extra.length > 0) {
    throw new Error("Usage: demo-recorder update check [--json]");
  }

  const manifest = await loadManifest();
  const comparison = compareSemver(cliVersion, manifest.version);
  const status: UpdateStatus = comparison < 0 ? "available" : comparison > 0 ? "ahead" : "current";
  const result = {
    status,
    currentVersion: cliVersion,
    latestVersion: manifest.version,
    releaseNotes: manifest.releaseNotes,
    skill: {
      name: manifest.skill.name,
      repository: manifest.skill.repository,
      tag: manifest.skill.tag,
      updateCommand: `npx skills update ${manifest.skill.name}`,
    },
    runtime: manifest.runtime,
    note:
      status === "available"
        ? "Update the skill first. The updated skill will request permission to install its matching runtime."
        : "No installation was performed.",
  };

  if (arguments_.options.has("json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (status === "available") {
    console.log(`[demo-recorder] Update available: ${cliVersion} → ${manifest.version}`);
    console.log(`[demo-recorder] Release notes: ${manifest.releaseNotes}`);
    console.log(`[demo-recorder] Update the skill first: ${result.skill.updateCommand}`);
    console.log(
      "[demo-recorder] The updated skill will install its matching cached runtime after approval.",
    );
    return;
  }
  if (status === "ahead") {
    console.log(
      `[demo-recorder] Installed version ${cliVersion} is newer than stable ${manifest.version}.`,
    );
    return;
  }
  console.log(`[demo-recorder] Demo Recorder ${cliVersion} is current.`);
}
