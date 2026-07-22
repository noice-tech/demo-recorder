import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { installSessionStorage, loadSessionStorage } from "./session-storage.js";

type AuthSessionDescriptor = {
  version: 1;
  pid: number;
  port: number;
  token: string;
  profileDirectory: string;
  baseUrl: string;
};

function validateProfile(profile: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(profile))
    throw new Error(`Invalid authentication profile name: ${profile}`);
  return profile;
}

function paths(rootDirectory: string, profile: string) {
  const root = resolve(rootDirectory);
  const safe = validateProfile(profile);
  return {
    profileDirectory: join(root, safe),
    descriptorPath: join(root, ".sessions", `${safe}.json`),
  };
}

async function readDescriptor(path: string): Promise<AuthSessionDescriptor> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as AuthSessionDescriptor;
  } catch (error) {
    throw new Error(`No active authentication session: ${path}`, { cause: error });
  }
}

export async function startAuthSession(options: {
  rootDirectory: string;
  profile: string;
  baseUrl: string;
}): Promise<AuthSessionDescriptor> {
  const { profileDirectory, descriptorPath } = paths(options.rootDirectory, options.profile);
  await mkdir(join(resolve(options.rootDirectory), ".sessions"), { recursive: true, mode: 0o700 });
  await mkdir(profileDirectory, { recursive: true, mode: 0o700 });
  await rm(descriptorPath, { force: true });
  const token = randomBytes(24).toString("hex");
  const sourceDaemon = fileURLToPath(new URL("./auth-daemon.ts", import.meta.url));
  const builtDaemon = fileURLToPath(new URL("./auth-daemon.js", import.meta.url));
  const daemon = existsSync(sourceDaemon) ? sourceDaemon : builtDaemon;
  const daemonArguments = daemon.endsWith(".ts")
    ? ["--import", "tsx", daemon, profileDirectory, descriptorPath, options.baseUrl, token]
    : [daemon, profileDirectory, descriptorPath, options.baseUrl, token];
  const child = spawn(process.execPath, daemonArguments, {
    detached: true,
    stdio: "ignore",
    cwd: process.cwd(),
  });
  child.unref();
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`Authentication browser exited with code ${child.exitCode}`);
    try {
      return await readDescriptor(descriptorPath);
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
  }
  throw new Error("Authentication browser did not start within 20 seconds");
}

async function authRequest(
  rootDirectory: string,
  profile: string,
  operation: "save" | "stop",
): Promise<void> {
  const { descriptorPath } = paths(rootDirectory, profile);
  const descriptor = await readDescriptor(descriptorPath);
  const response = await fetch(`http://127.0.0.1:${descriptor.port}/${operation}`, {
    method: "POST",
    headers: { authorization: `Bearer ${descriptor.token}` },
  });
  if (!response.ok) throw new Error(`Authentication ${operation} failed: ${await response.text()}`);
  if (operation === "save") {
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
    await Promise.all(
      ["storage-state.json", "session-storage.json", "profile.json"].map((name) =>
        chmod(join(descriptor.profileDirectory, name), 0o600).catch(() => undefined),
      ),
    );
  }
}

export async function saveAuthSession(rootDirectory: string, profile: string): Promise<void> {
  await authRequest(rootDirectory, profile, "save");
}

export async function stopAuthSession(rootDirectory: string, profile: string): Promise<void> {
  await authRequest(rootDirectory, profile, "stop");
}

export async function listAuthProfiles(rootDirectory: string): Promise<string[]> {
  const root = resolve(rootDirectory);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const profiles = entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name !== ".sessions" &&
        existsSync(join(root, entry.name, "profile.json")),
    )
    .map((entry) => entry.name);
  // Node 22 target does not expose Array#toSorted in the TypeScript ES2022 library.
  // oxlint-disable-next-line unicorn/no-array-sort
  return profiles.sort();
}

export async function removeAuthProfile(rootDirectory: string, profile: string): Promise<void> {
  const { profileDirectory, descriptorPath } = paths(rootDirectory, profile);
  if (existsSync(descriptorPath))
    await stopAuthSession(rootDirectory, profile).catch(() => undefined);
  await rm(profileDirectory, { recursive: true, force: true });
  await rm(descriptorPath, { force: true });
}

export function authProfilePaths(
  rootDirectory: string,
  profile: string,
): { storageStatePath: string; sessionStoragePath: string; profilePath: string } {
  const { profileDirectory } = paths(rootDirectory, profile);
  return {
    storageStatePath: join(profileDirectory, "storage-state.json"),
    sessionStoragePath: join(profileDirectory, "session-storage.json"),
    profilePath: join(profileDirectory, "profile.json"),
  };
}

export async function verifyAuthProfile(
  rootDirectory: string,
  profile: string,
): Promise<{ finalUrl: string; hasPasswordField: boolean }> {
  const authPaths = authProfilePaths(rootDirectory, profile);
  const metadata = JSON.parse(await readFile(authPaths.profilePath, "utf8")) as { baseUrl: string };
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ storageState: authPaths.storageStatePath });
    await installSessionStorage(context, await loadSessionStorage(authPaths.sessionStoragePath));
    const page = await context.newPage();
    await page.goto(metadata.baseUrl, { waitUntil: "domcontentloaded" });
    const result = {
      finalUrl: page.url(),
      hasPasswordField: (await page.locator('input[type="password"]').count()) > 0,
    };
    await context.close();
    return result;
  } finally {
    await browser.close();
  }
}
