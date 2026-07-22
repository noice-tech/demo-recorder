import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const packageRoot = fileURLToPath(new URL("..", import.meta.url));
export const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
export const workingDirectory =
  process.env.DEMO_RECORDER_CWD ?? process.env.INIT_CWD ?? process.cwd();

function existingDirectory(candidates: string[]): string | undefined {
  return candidates.find((candidate) => existsSync(join(candidate, "index.html")));
}

export function findRemotionBundle(): string | undefined {
  return existingDirectory([
    ...(process.env.DEMO_RECORDER_REMOTION_BUNDLE
      ? [process.env.DEMO_RECORDER_REMOTION_BUNDLE]
      : []),
    join(packageRoot, "assets/remotion"),
    join(repositoryRoot, "apps/remotion/build"),
  ]);
}

export function requireRemotionBundle(): string {
  const path = findRemotionBundle();
  if (path) return path;
  throw new Error(
    "Remotion composition is missing. Run `pnpm package:cli` in a source checkout or reinstall Demo Recorder.",
  );
}
