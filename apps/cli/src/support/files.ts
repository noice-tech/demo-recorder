import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Reads and parses a JSON file, naming it in any error. */
export async function readJson(path: string): Promise<unknown> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`Unable to read ${path}`, { cause: error });
  }
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON at ${path}`, { cause: error });
  }
}

/** Writes JSON through a temp file and a rename, so readers never see a partial file. */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export async function writeFileAtomic(path: string, contents: string | Uint8Array): Promise<void> {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporary, contents);
  await rename(temporary, path);
}

export async function removeFile(path: string): Promise<void> {
  await rm(path, { force: true });
}

export function exists(path: string): Promise<boolean> {
  return readFile(path).then(
    () => true,
    () => false,
  );
}
