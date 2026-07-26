import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, open, rename, rm, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";

export const explorationArtifactLimits = {
  snapshotBytes: 2 * 1024 * 1024,
  jsonBytes: 4 * 1024 * 1024,
  summaryBytes: 512 * 1024,
  ndjsonBytes: 16 * 1024 * 1024,
  screenshotBytes: 12 * 1024 * 1024,
  traceBytes: 128 * 1024 * 1024,
} as const;

export class ExplorationArtifactLimitError extends Error {}

function cappedUtf8(value: string, maxBytes: number): { value: string; truncated: boolean } {
  const encoded = Buffer.from(value);
  if (encoded.byteLength <= maxBytes) return { value, truncated: false };
  const suffix = Buffer.from("\n[truncated by Demo Recorder]\n");
  if (maxBytes < suffix.byteLength)
    throw new ExplorationArtifactLimitError(`Artifact limit ${maxBytes} is too small`);
  let prefix = encoded.subarray(0, maxBytes - suffix.byteLength).toString("utf8");
  if (prefix.endsWith("�")) prefix = prefix.slice(0, -1);
  return { value: `${prefix}${suffix.toString("utf8")}`, truncated: true };
}

export class ExplorationArtifactStore {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  path(relativePath: string): string {
    if (!relativePath || isAbsolute(relativePath) || relativePath.includes("\0"))
      throw new Error(`Invalid exploration artifact path: ${relativePath}`);
    const absolutePath = resolve(this.root, relativePath);
    if (absolutePath !== this.root && !absolutePath.startsWith(`${this.root}${sep}`))
      throw new Error(`Exploration artifact path leaves its root: ${relativePath}`);
    return absolutePath;
  }

  relativePath(absolutePath: string): string {
    const normalized = resolve(absolutePath);
    if (normalized !== this.root && !normalized.startsWith(`${this.root}${sep}`))
      throw new Error(`Exploration artifact is outside its root: ${absolutePath}`);
    return relative(this.root, normalized).replaceAll("\\", "/");
  }

  async initialize(directories: string[] = []): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const rootMetadata = await lstat(this.root);
    if (rootMetadata.isSymbolicLink())
      throw new Error(`Exploration artifact root cannot be a symbolic link: ${this.root}`);
    await Promise.all(directories.map((directory) => this.ensureDirectory(directory)));
  }

  async writeText(
    relativePath: string,
    value: string,
    maxBytes = explorationArtifactLimits.summaryBytes,
  ): Promise<{ truncated: boolean }> {
    const capped = cappedUtf8(value, maxBytes);
    await this.atomicWrite(relativePath, Buffer.from(capped.value));
    return { truncated: capped.truncated };
  }

  async writeJson(
    relativePath: string,
    value: unknown,
    maxBytes = explorationArtifactLimits.jsonBytes,
  ): Promise<void> {
    const content = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    if (content.byteLength > maxBytes)
      throw new ExplorationArtifactLimitError(
        `JSON artifact ${relativePath} exceeds ${maxBytes} bytes`,
      );
    await this.atomicWrite(relativePath, content);
  }

  async appendJsonLine(
    relativePath: string,
    value: unknown,
    maxBytes = explorationArtifactLimits.ndjsonBytes,
  ): Promise<void> {
    const absolutePath = this.path(relativePath);
    await this.ensureDirectory(this.relativePath(dirname(absolutePath)));
    await this.rejectSymlink(absolutePath);
    const line = Buffer.from(`${JSON.stringify(value)}\n`);
    if (line.byteLength > explorationArtifactLimits.jsonBytes)
      throw new ExplorationArtifactLimitError(`NDJSON line for ${relativePath} is too large`);
    const currentSize = await stat(absolutePath)
      .then((metadata) => metadata.size)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return 0;
        throw error;
      });
    if (currentSize + line.byteLength > maxBytes)
      throw new ExplorationArtifactLimitError(
        `NDJSON artifact ${relativePath} exceeds ${maxBytes} bytes`,
      );
    const file = await open(absolutePath, "a", 0o600);
    try {
      await file.write(line);
      await file.sync();
    } finally {
      await file.close();
    }
  }

  async writeExternalFile(
    relativePath: string,
    maxBytes: number,
    write: (temporaryPath: string) => Promise<void>,
  ): Promise<void> {
    const absolutePath = this.path(relativePath);
    await this.ensureDirectory(this.relativePath(dirname(absolutePath)));
    await this.rejectSymlink(absolutePath);
    const extension = extname(absolutePath);
    const stem = extension ? absolutePath.slice(0, -extension.length) : absolutePath;
    const temporaryPath = `${stem}.${process.pid}.${randomBytes(6).toString("hex")}.tmp${extension}`;
    try {
      await write(temporaryPath);
      const metadata = await lstat(temporaryPath);
      if (!metadata.isFile() || metadata.isSymbolicLink())
        throw new Error(`External artifact writer did not create a regular file: ${relativePath}`);
      if (metadata.size > maxBytes)
        throw new ExplorationArtifactLimitError(
          `Artifact ${relativePath} exceeds ${maxBytes} bytes`,
        );
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, absolutePath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async assertFileLimit(relativePath: string, maxBytes: number): Promise<void> {
    const absolutePath = this.path(relativePath);
    await this.rejectSymlink(absolutePath);
    const metadata = await stat(absolutePath);
    if (metadata.size <= maxBytes) return;
    await rm(absolutePath, { force: true });
    throw new ExplorationArtifactLimitError(`Artifact ${relativePath} exceeds ${maxBytes} bytes`);
  }

  // Walk each component instead of relying on recursive mkdir: an existing symlink anywhere in
  // the path could otherwise redirect artifacts outside the configured output root.
  private async ensureDirectory(relativeDirectory: string): Promise<void> {
    if (!relativeDirectory || relativeDirectory === ".") return;
    const normalizedRelative = this.relativePath(this.path(relativeDirectory));
    const parts = normalizedRelative.replaceAll("\\", "/").split("/");
    let current = this.root;
    for (const part of parts) {
      if (!part || part === ".") continue;
      current = resolve(current, part);
      const metadata = await lstat(current).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (metadata?.isSymbolicLink())
        throw new Error(`Exploration artifact directory cannot be a symbolic link: ${current}`);
      if (metadata && !metadata.isDirectory())
        throw new Error(`Exploration artifact parent is not a directory: ${current}`);
      if (!metadata) await mkdir(current);
    }
  }

  private async rejectSymlink(absolutePath: string): Promise<void> {
    const metadata = await lstat(absolutePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (metadata?.isSymbolicLink())
      throw new Error(`Exploration artifact cannot be a symbolic link: ${absolutePath}`);
  }

  // Publish only complete files. Readers may poll these artifacts while the daemon is running.
  private async atomicWrite(relativePath: string, content: Buffer): Promise<void> {
    const absolutePath = this.path(relativePath);
    await this.ensureDirectory(this.relativePath(dirname(absolutePath)));
    await this.rejectSymlink(absolutePath);
    const temporaryPath = `${absolutePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    const file = await open(temporaryPath, "wx", 0o600);
    try {
      await file.writeFile(content);
      await file.sync();
      await file.close();
      await rename(temporaryPath, absolutePath);
    } catch (error) {
      await file.close().catch(() => undefined);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}
