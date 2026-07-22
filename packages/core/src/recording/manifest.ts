import { readFile } from "node:fs/promises";
import { recordingManifestSchema } from "./schema.js";
import type { RecordingManifest } from "./types.js";

export function parseRecordingManifest(input: unknown): RecordingManifest {
  return recordingManifestSchema.parse(input);
}

export async function loadRecordingManifest(path: string): Promise<RecordingManifest> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`Unable to read recording manifest at ${path}`, { cause: error });
  }

  try {
    return parseRecordingManifest(JSON.parse(source) as unknown);
  } catch (error) {
    throw new Error(`Invalid recording manifest at ${path}`, { cause: error });
  }
}
