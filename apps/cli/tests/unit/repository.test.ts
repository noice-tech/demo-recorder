import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectRepository } from "../../src/explorer/index.js";

describe("repository inspection", () => {
  it("reports scripts, framework, routes, and environment variable names without values", async () => {
    const root = await mkdtemp(join(tmpdir(), "explorer-repo-"));
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
    expect(JSON.stringify(report)).not.toContain("secret-value");
  });
});
