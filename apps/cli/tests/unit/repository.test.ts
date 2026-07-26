import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectRepository } from "../../src/explorer/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "explorer-repo-"));
  roots.push(root);
  return root;
}

describe("repository inspection", () => {
  it("reports scripts, framework, routes, and environment variable names without values", async () => {
    const root = await repository();
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ scripts: { dev: "next dev" }, dependencies: { next: "1" } }),
    );
    await writeFile(join(root, "route.ts"), "const key = process.env.DEMO_TOKEN; export {key};");
    const report = await inspectRepository(root);
    expect(report.framework).toBe("Next.js");
    expect(report.scripts.dev).toBe("next dev");
    expect(report.routeFiles).toContain("route.ts");
    expect(report.environmentVariableNames).toContain("DEMO_TOKEN");
    expect(report.scan.filesRead).toBeGreaterThan(0);
    expect(report.scan.bytesRead).toBeGreaterThan(0);
    expect(JSON.stringify(report)).not.toContain("secret-value");
  });

  it.runIf(process.platform !== "win32")(
    "skips symlinks and files outside configured byte limits",
    async () => {
      const root = await repository();
      const outside = await repository();
      await writeFile(join(root, "route.ts"), "export const route = true;");
      await writeFile(join(root, "large.ts"), "x".repeat(200));
      await writeFile(join(outside, "secret.ts"), "const key = process.env.OUTSIDE_SECRET;");
      await symlink(join(outside, "secret.ts"), join(root, "linked-secret.ts"));
      const report = await inspectRepository(root, {
        maxFileBytes: 64,
        maxTotalBytes: 1_024,
        readConcurrency: 2,
      });
      expect(report.scan.skippedLargeFiles).toBe(1);
      expect(report.scan.skippedSymlinks).toBe(1);
      expect(report.scan.truncated).toBe(true);
      expect(report.environmentVariableNames).not.toContain("OUTSIDE_SECRET");
    },
  );

  it("keeps agent-authored hints explicitly advisory", async () => {
    const root = await repository();
    await writeFile(join(root, "package.json"), "{}");
    await writeFile(
      join(root, "demo-recorder.hints.json"),
      JSON.stringify({
        version: 1,
        routes: ["/workspace"],
        tests: ["tests/workspace.spec.ts"],
        authentication: ["Login requires a disposable test account"],
        notes: ["Open the Templates tab"],
      }),
    );
    const report = await inspectRepository(root, {
      hintsPath: "demo-recorder.hints.json",
    });
    expect(report.advisoryHints).toMatchObject({
      source: "demo-recorder.hints.json",
      routes: ["/workspace"],
      notes: ["Open the Templates tab"],
    });
    expect(report.routeFiles).not.toContain("/workspace");
  });
});
