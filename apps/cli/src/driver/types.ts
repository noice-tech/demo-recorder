import type { Action, Expect, Target } from "@noice-tech/demo-recorder-core";
import type { ElementFacts } from "../policy.js";

export type Capability =
  | "launch"
  | "attach"
  | "ownLifecycle"
  | "isolatedContext"
  | "listPages"
  | "authState"
  | "capture"
  | "guarded";

export type PageRef = { id: string; url: string; title: string };

export type ConnectOptions = {
  mode: "launched" | "attached";
  headless: boolean;
  viewport: { width: number; height: number };
  /** Driver-specific connection target. Present when reconnecting to a live session. */
  target?: string;
  /** Launch a browser that outlives one command (explore sessions only). */
  persistent?: boolean;
  /** Session file the persistent browser server watches for idle timeout. */
  touchFile?: string;
  /** Overrides for a persistent browser host. */
  idleTimeoutMs?: number;
  maxDurationMs?: number;
  pageId?: string;
  storageStatePath?: string;
  /** Turns on the runtime effect boundary, allowing top-level navigation to these origins. */
  allowedOrigins?: readonly string[];
};

export type Risk = "read-only" | "reversible" | "destructive" | "external-side-effect" | "unknown";

/**
 * A node of Playwright's AI snapshot that carries a ref. Ref numbers are only
 * meaningful to the connection that took the snapshot, so `path` (child indices
 * from the root) is what finds the same node again from a later command.
 */
export type SnapshotElement = { ref: string; role: string; name?: string; path: number[] };

export type PageInspection = {
  url: string;
  title: string;
  scroll: { x: number; y: number };
  /** Playwright's AI-mode ARIA snapshot (YAML with `[ref=eN]` markers). */
  snapshot: string;
  elements: SnapshotElement[];
  errors: string[];
};

/** A ref resolved against the live page, with what policy and target derivation need. */
export type ResolvedRef = SnapshotElement & {
  /** Named ancestors, nearest first, that can narrow a duplicated target. */
  scopes: Array<{ role: string; name: string }>;
  facts: Omit<ElementFacts, "role" | "name">;
};

export interface Recorder {
  readonly startedAtNs: bigint;
  stop(): Promise<{ durationMs: number }>;
  abort(): Promise<void>;
}

export interface Session {
  readonly target: string;
  /** Whether the driver's runtime effect boundary is active for this session. */
  readonly guarded: boolean;
  /** OS process that owns the browser, when the driver launched one for a live session. */
  readonly pid?: number;
  listPages(): Promise<PageRef[]>;
  selectPage(id: string): Promise<void>;
  goto(url: string): Promise<void>;
  perform(action: Action): Promise<void>;
  /** What the boundary blocked since the last interaction. */
  blocked(): readonly string[];
  waitFor(expect: Expect): Promise<void>;
  /** Number of live elements a target resolves to. Must be exactly one to be recordable. */
  countMatches(target: Target): Promise<number>;
  bounds(
    target: Target,
  ): Promise<{ x: number; y: number; width: number; height: number } | undefined>;
  mouseMove(x: number, y: number): Promise<void>;
  /** Current document scroll offset, and the largest vertical offset the document allows. */
  scrollPosition(): Promise<{ x: number; y: number; maxY: number }>;
  url(): Promise<string>;
  inspect(): Promise<PageInspection>;
  /** Finds the node at `path` in a fresh AI snapshot; its `ref` is live for this connection. */
  resolveElement(path: number[]): Promise<ResolvedRef | undefined>;
  snapshot(): Promise<string>;
  screenshot(path: string): Promise<void>;
  saveStorageState(path: string): Promise<void>;
  startCapture(path: string): Promise<Recorder>;
  close(): Promise<void>;
}

export interface Driver {
  readonly name: string;
  readonly capabilities: ReadonlySet<Capability>;
  /** Discover attached tabs without selecting or creating a project session. */
  listPages?(target: string): Promise<PageRef[]>;
  connect(options: ConnectOptions): Promise<Session>;
}

export function requireCapability(driver: Driver, capability: Capability): void {
  if (!driver.capabilities.has(capability)) {
    throw new Error(`Driver "${driver.name}" does not support the "${capability}" capability`);
  }
}
