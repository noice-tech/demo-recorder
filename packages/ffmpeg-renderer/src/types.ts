import type { DemoTimeline, RecordingManifest, RenderConfig } from "@noice-tech/demo-recorder-core";

export type ProductDemoRenderInput = {
  sourcePath: string;
  recording: RecordingManifest;
  timeline: DemoTimeline;
  config: RenderConfig;
};

export type RenderProductDemoOptions = {
  outputPath: string;
  assetsDirectory?: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  overwrite?: boolean;
  signal?: AbortSignal;
  log?: (message: string) => void;
  onProgress?: (progress: number) => void;
};

export type RenderProductDemoResult = {
  outputPath: string;
  frameCount: number;
  durationMs: number;
};
