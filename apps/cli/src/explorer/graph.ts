import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  explorationGraphSchema,
  explorationObservationSchema,
  explorationTransitionSchema,
  type ExplorationGraph,
  type ExplorationObservation,
  type ExplorationSemanticDiff,
  type ExplorationTransition,
} from "./interactive-schema.js";

export function normalizeAriaSnapshot(snapshot: string): string {
  return snapshot
    .replaceAll(/\[ref=e\d+\]/g, "")
    .replaceAll(/\[box=[^\]]+\]/g, "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

export function explorationSemanticFingerprint(pathname: string, snapshot: string): string {
  return createHash("sha256")
    .update(`${pathname}\n${normalizeAriaSnapshot(snapshot)}`)
    .digest("hex");
}

function difference(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return [...new Set(left)].filter((value) => !rightSet.has(value));
}

function controlKeys(observation: ExplorationObservation): string[] {
  return observation.interactiveElements.map(
    (element) =>
      `${element.role ?? element.tagName.toLowerCase()}|${element.name}|${element.enabled}|${element.selected ?? ""}|${element.checked ?? ""}|${element.pressed ?? ""}|${element.expanded ?? ""}`,
  );
}

function layerKeys(observation: ExplorationObservation): string[] {
  return observation.layers.map((layer) => `${layer.role}|${layer.name}`);
}

function orderedBySequence<T extends { sequence: number }>(values: T[]): T[] {
  const ordered: T[] = [];
  for (const value of values) {
    const index = ordered.findIndex((existing) => existing.sequence > value.sequence);
    if (index === -1) ordered.push(value);
    else ordered.splice(index, 0, value);
  }
  return ordered;
}

export function diffExplorationObservations(
  before: ExplorationObservation,
  after: ExplorationObservation,
): ExplorationSemanticDiff {
  const beforeLayers = layerKeys(before);
  const afterLayers = layerKeys(after);
  const beforeControls = controlKeys(before);
  const afterControls = controlKeys(after);
  return {
    urlChanged: before.url !== after.url,
    titleChanged: before.title !== after.title,
    headingsAdded: difference(after.headings, before.headings),
    headingsRemoved: difference(before.headings, after.headings),
    layersAdded: difference(afterLayers, beforeLayers),
    layersRemoved: difference(beforeLayers, afterLayers),
    controlsAdded: difference(afterControls, beforeControls),
    controlsRemoved: difference(beforeControls, afterControls),
  };
}

export function materializeExplorationGraph(
  observations: ExplorationObservation[],
  transitions: ExplorationTransition[],
): ExplorationGraph {
  const grouped = new Map<
    string,
    { fingerprint: string; observationIds: string[]; canonicalObservationId: string }
  >();
  for (const observation of orderedBySequence(observations)) {
    const existing = grouped.get(observation.stateId);
    if (existing) {
      if (existing.fingerprint !== observation.semanticFingerprint)
        throw new Error(`State ${observation.stateId} has conflicting semantic fingerprints`);
      existing.observationIds.push(observation.id);
    } else {
      grouped.set(observation.stateId, {
        fingerprint: observation.semanticFingerprint,
        canonicalObservationId: observation.id,
        observationIds: [observation.id],
      });
    }
  }
  return explorationGraphSchema.parse({
    schemaVersion: 2,
    states: [...grouped.entries()].map(([id, state]) => ({ id, ...state })),
    observations: orderedBySequence(observations).map((observation) => ({
      id: observation.id,
      stateId: observation.stateId,
      sequence: observation.sequence,
    })),
    transitions: orderedBySequence(transitions).map((transition) => ({
      id: transition.id,
      status: transition.status,
      fromStateId: transition.fromStateId,
      ...(transition.toStateId ? { toStateId: transition.toStateId } : {}),
    })),
  });
}

async function readJournal<T>(path: string, parse: (value: unknown) => T): Promise<T[]> {
  const content = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  return content
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      try {
        return parse(JSON.parse(line) as unknown);
      } catch (error) {
        throw new Error(`Invalid journal entry ${index + 1} in ${path}`, { cause: error });
      }
    });
}

export async function recoverExplorationGraph(
  observationsJournalPath: string,
  transitionsJournalPath: string,
): Promise<ExplorationGraph> {
  const [observations, transitions] = await Promise.all([
    readJournal(observationsJournalPath, (value) => explorationObservationSchema.parse(value)),
    readJournal(transitionsJournalPath, (value) => explorationTransitionSchema.parse(value)),
  ]);
  return materializeExplorationGraph(observations, transitions);
}
