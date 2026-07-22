import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  authProfilePaths,
  exploreSite,
  inspectRepository,
  startManagedApp,
} from "./explorer/index.js";
import { numberOption, stringOption, type ParsedArguments } from "./arguments.js";
import { workingDirectory } from "./paths.js";

function generatedId(prefix: string): string {
  return `${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}-${prefix}-${randomUUID().slice(0, 8)}`;
}

function resolveWorkingPath(path: string): string {
  return isAbsolute(path) ? path : resolve(workingDirectory, path);
}

export async function exploreCommand(arguments_: ParsedArguments): Promise<string> {
  const url = stringOption(arguments_, "url");
  if (!url) throw new Error("explore requires --url <http-or-https-url>");
  const repositoryPath = stringOption(arguments_, "repo");
  const resolvedRepository = repositoryPath ? resolve(workingDirectory, repositoryPath) : undefined;
  const startCommand = stringOption(arguments_, "start");
  const readinessUrl = stringOption(arguments_, "readiness-url") ?? url;
  const outputDirectory = resolveWorkingPath(
    stringOption(arguments_, "output") ??
      join(workingDirectory, ".demo-recorder/explorations", generatedId("exploration")),
  );
  const authProfile = stringOption(arguments_, "auth");
  const authPaths = authProfile
    ? authProfilePaths(join(workingDirectory, ".demo-recorder/auth"), authProfile)
    : undefined;
  let managed: Awaited<ReturnType<typeof startManagedApp>> | undefined;
  try {
    if (startCommand) {
      if (!resolvedRepository)
        throw new Error("--start requires --repo so the command has an explicit working directory");
      console.log(`[demo-recorder] Starting managed application: ${startCommand}`);
      managed = await startManagedApp({
        command: startCommand,
        cwd: resolvedRepository,
        readinessUrl,
        log: (line) => process.stdout.write(`[target] ${line}`),
      });
    }
    console.log(`[demo-recorder] Exploring ${url}`);
    const report = await exploreSite({
      baseUrl: url,
      outputDirectory,
      maxPages: numberOption(arguments_, "max-pages", 10),
      maxDepth: numberOption(arguments_, "max-depth", 2),
      sameOriginOnly: !arguments_.options.has("allow-cross-origin"),
      headless: !arguments_.options.has("headed"),
      ...(authPaths
        ? {
            storageStatePath: authPaths.storageStatePath,
            sessionStoragePath: authPaths.sessionStoragePath,
          }
        : {}),
      ...(authProfile ? { authProfile } : {}),
      ...(resolvedRepository ? { repositoryPath: resolvedRepository } : {}),
    });
    console.log(
      `[demo-recorder] Explored ${report.pages.length} page${report.pages.length === 1 ? "" : "s"}`,
    );
    console.log(`[demo-recorder] Exploration saved: ${outputDirectory}`);
    return outputDirectory;
  } finally {
    if (managed) await managed.close();
  }
}

export async function inspectRepositoryCommand(arguments_: ParsedArguments): Promise<string> {
  const repositoryPath = resolve(workingDirectory, stringOption(arguments_, "repo") ?? ".");
  const outputPath = resolveWorkingPath(
    stringOption(arguments_, "output") ?? join(workingDirectory, ".demo-recorder/repository.json"),
  );
  const report = await inspectRepository(repositoryPath);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[demo-recorder] Repository report saved: ${outputPath}`);
  return outputPath;
}
