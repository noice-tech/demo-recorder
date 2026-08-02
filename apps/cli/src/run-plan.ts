import { randomUUID } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { recordDemoPlan } from "./capture/index.js";
import { loadDemoPlan } from "./demo-plan/index.js";
import { authProfilePaths, startManagedApp } from "./explorer/index.js";
import { renderDemoVideo, type RenderDemoVideoResult } from "./renderer/index.js";
import { requireFfmpegAssets, workingDirectory } from "./paths.js";

function recordingId(name: string): string {
  return `${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}-${name}-${randomUUID().slice(0, 8)}`;
}

export async function recordPlan(
  planArgument: string,
  options: { headless?: boolean; recordingsDirectory?: string } = {},
): Promise<string> {
  const planPath = resolve(workingDirectory, planArgument);
  const plan = await loadDemoPlan(planPath);
  const repositoryPath = resolve(workingDirectory, plan.target.repositoryPath ?? ".");
  let managed: Awaited<ReturnType<typeof startManagedApp>> | undefined;
  try {
    if (plan.target.startCommand) {
      const readinessUrl = plan.target.readinessUrl ?? plan.target.baseUrl;
      console.log(`[demo-recorder] Starting managed application: ${plan.target.startCommand}`);
      managed = await startManagedApp({
        command: plan.target.startCommand,
        cwd: repositoryPath,
        readinessUrl,
        log: (line) => process.stdout.write(`[target] ${line}`),
      });
    }
    const id = recordingId(plan.name);
    const outputDirectory = join(
      options.recordingsDirectory ?? join(workingDirectory, "recordings"),
      id,
    );
    const authPaths = plan.target.authProfile
      ? authProfilePaths(join(workingDirectory, ".demo-recorder/auth"), plan.target.authProfile)
      : undefined;
    console.log(`[demo-recorder] Recording plan: ${plan.name}`);
    await recordDemoPlan(plan, {
      outputDirectory,
      viewport: plan.capture.viewport ?? { width: 1440, height: 900 },
      headless: options.headless ?? true,
      ...(authPaths
        ? {
            storageStatePath: authPaths.storageStatePath,
            sessionStoragePath: authPaths.sessionStoragePath,
          }
        : {}),
    });
    console.log(`[demo-recorder] Recording saved: ${outputDirectory}`);
    return outputDirectory;
  } finally {
    if (managed) {
      await managed.close();
      console.log("[demo-recorder] Managed application stopped");
    }
  }
}

export async function runPlan(
  planArgument: string,
  options: { headless?: boolean } = {},
): Promise<RenderDemoVideoResult> {
  const recordingDirectory = await recordPlan(planArgument, options);
  const id = basename(recordingDirectory);
  return renderDemoVideo(recordingDirectory, {
    assetsDirectory: requireFfmpegAssets(),
    outputPath: join(workingDirectory, "output", `${id}.mp4`),
  });
}
