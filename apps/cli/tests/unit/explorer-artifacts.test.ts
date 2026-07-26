import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ExplorationArtifactLimitError,
  ExplorationArtifactStore,
} from "../../src/explorer/artifacts.js";
import { sanitizeExplorationError, sanitizeExplorationUrl } from "../../src/explorer/privacy.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "demo-recorder-artifacts-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("exploration artifact store", () => {
  it("rejects paths outside the artifact root", async () => {
    const root = await temporaryDirectory();
    const store = new ExplorationArtifactStore(root);
    expect(() => store.path("../secret.json")).toThrow(/leaves its root/);
    expect(() => store.path(join(root, "absolute.json"))).toThrow(/Invalid/);
    expect(() => store.relativePath(join(root, "..", "secret.json"))).toThrow(/outside its root/);
  });

  it.runIf(process.platform !== "win32")(
    "does not follow nested artifact-directory symbolic links",
    async () => {
      const root = await temporaryDirectory();
      const outside = await temporaryDirectory();
      await symlink(outside, join(root, "observations"));
      const store = new ExplorationArtifactStore(root);
      await expect(store.writeJson("observations/obs-1.json", { secret: true })).rejects.toThrow(
        /symbolic link/,
      );
      expect(await readdir(outside)).toEqual([]);
    },
  );

  it("atomically writes JSON without leaving temporary files", async () => {
    const root = await temporaryDirectory();
    const store = new ExplorationArtifactStore(root);
    await store.writeJson("nested/report.json", { version: 2, ok: true });
    expect(JSON.parse(await readFile(join(root, "nested/report.json"), "utf8"))).toEqual({
      version: 2,
      ok: true,
    });
    expect(await readdir(join(root, "nested"))).toEqual(["report.json"]);
  });

  it("caps text on a UTF-8 boundary and rejects oversized structured artifacts", async () => {
    const root = await temporaryDirectory();
    const store = new ExplorationArtifactStore(root);
    const result = await store.writeText("snapshot.yml", "🎵".repeat(100), 64);
    const snapshot = await readFile(join(root, "snapshot.yml"), "utf8");
    expect(result.truncated).toBe(true);
    expect(snapshot).toContain("[truncated by Demo Recorder]");
    expect(snapshot).not.toContain("�");
    await expect(
      store.writeJson("large.json", { value: "x".repeat(100) }, 32),
    ).rejects.toBeInstanceOf(ExplorationArtifactLimitError);
  });

  it("enforces an append-only journal cap", async () => {
    const root = await temporaryDirectory();
    const store = new ExplorationArtifactStore(root);
    await store.appendJsonLine("transitions.ndjson", { id: 1 }, 15);
    await expect(store.appendJsonLine("transitions.ndjson", { id: 2 }, 15)).rejects.toBeInstanceOf(
      ExplorationArtifactLimitError,
    );
    expect((await readFile(join(root, "transitions.ndjson"), "utf8")).trim()).toBe('{"id":1}');
  });

  it("checks externally written binary artifacts", async () => {
    const root = await temporaryDirectory();
    const store = new ExplorationArtifactStore(root);
    await writeFile(join(root, "screenshot.png"), Buffer.alloc(20));
    await expect(store.assertFileLimit("screenshot.png", 10)).rejects.toBeInstanceOf(
      ExplorationArtifactLimitError,
    );
  });
});

describe("exploration privacy", () => {
  it("removes credentials, query values, and fragments from shareable URLs", () => {
    const input = "https://user:password@example.com/private?token=super-secret#access-key";
    expect(sanitizeExplorationUrl(input)).toBe("https://example.com/private");
  });

  it("sanitizes URLs embedded in browser errors", () => {
    const error = sanitizeExplorationError(
      "Failed https://example.com/callback?code=secret#token and https://other.test/a?q=private",
    );
    expect(error).toBe("Failed https://example.com/callback and https://other.test/a");
    expect(error).not.toMatch(/secret|private|token/);
  });
});
