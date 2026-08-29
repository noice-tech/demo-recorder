import type { RecordingManifest, Viewport } from "@noice-tech/demo-recorder-core";
import type { Locator, Page } from "playwright";

export type RecordingSessionOptions = {
  outputDirectory: string;
  viewport: Pick<Viewport, "width" | "height">;
  headless?: boolean;
  baseUrl?: string;
  storageStatePath?: string;
  sessionStoragePath?: string;
};

export type MoveOptions = {
  durationMs?: number;
  steps?: number;
};

export type ClickOptions = MoveOptions & {
  button?: "left" | "middle" | "right";
  delayMs?: number;
};

export type FillOptions = MoveOptions & {
  delayMs?: number;
};

export type WaitForOptions = {
  timeoutMs?: number;
};

export type DemoActions = {
  goto(url: string): Promise<void>;
  moveTo(locator: Locator, options?: MoveOptions): Promise<void>;
  click(locator: Locator, options?: ClickOptions): Promise<void>;
  fill(locator: Locator, value: string, options?: FillOptions): Promise<void>;
  press(key: string, locator?: Locator, options?: MoveOptions): Promise<void>;
  select(locator: Locator, value: string, options?: MoveOptions): Promise<void>;
  scroll(deltaY: number, deltaX?: number): Promise<void>;
  waitFor(locator: Locator, options?: WaitForOptions): Promise<void>;
  waitForUrl(urlPattern: string, options?: WaitForOptions): Promise<void>;
  wait(durationMs: number): Promise<void>;
};

export type RecordingSession = {
  page: Page;
  actions: DemoActions;
  baseUrl?: string;
  readonly outputDirectory: string;
  stop(): Promise<RecordingManifest>;
  abort(): Promise<void>;
};
