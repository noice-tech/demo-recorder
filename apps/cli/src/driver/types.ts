import type { Action, Expect, Target } from "@noice-tech/demo-recorder-core";

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
};

export type Risk = "read-only" | "reversible" | "destructive" | "external-side-effect" | "unknown";

export type ObservedElement = {
  ref: string;
  role: string;
  name: string;
  enabled: boolean;
  visible: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  risk: Risk;
  target: Target;
  /** Internal, uniquely identifies the element for one observation. Never exported to plans. */
  selector: string;
};

export type PageInspection = {
  url: string;
  title: string;
  scroll: { x: number; y: number };
  headings: string[];
  elements: ObservedElement[];
  errors: string[];
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
  waitFor(expect: Expect): Promise<void>;
  /** Number of live elements a target resolves to. Must be exactly one to be recordable. */
  countMatches(target: Target): Promise<number>;
  bounds(
    target: Target,
  ): Promise<{ x: number; y: number; width: number; height: number } | undefined>;
  mouseMove(x: number, y: number): Promise<void>;
  url(): Promise<string>;
  inspect(): Promise<PageInspection>;
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
