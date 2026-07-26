import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

async function cleanGeneratedDirectory(path: string): Promise<void> {
  const entries = await readdir(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  await Promise.all(
    entries
      .filter((entry) => entry !== ".gitkeep")
      .map((entry) => rm(join(path, entry), { recursive: true, force: true })),
  );
}

async function workspaceDirectories(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name));
}

const workspaces = (
  await Promise.all([
    workspaceDirectories(join(repositoryRoot, "apps")),
    workspaceDirectories(join(repositoryRoot, "packages")),
  ])
).flat();

await Promise.all([
  cleanGeneratedDirectory(join(repositoryRoot, "recordings")),
  cleanGeneratedDirectory(join(repositoryRoot, "output")),
  rm(join(repositoryRoot, "apps/remotion/build"), { recursive: true, force: true }),
  rm(join(repositoryRoot, "apps/remotion/public/generated"), { recursive: true, force: true }),
  rm(join(repositoryRoot, "apps/cli/assets"), { recursive: true, force: true }),
  ...workspaces.map((workspace) => rm(join(workspace, "dist"), { recursive: true, force: true })),
  rm(join(repositoryRoot, ".demo-recorder/explorations"), { recursive: true, force: true }),
]);

console.log(
  "[demo-recorder] Removed generated explorations, recordings, outputs, workspace dist directories, bundles, and Studio assets; plans and auth profiles were preserved",
);
