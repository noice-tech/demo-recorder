import type { RenderConfig } from "../config/types.js";
import type { ClickEvent, RecordingManifest } from "../recording/types.js";

export type ClickCluster = {
  clicks: ClickEvent[];
  centerX: number;
  centerY: number;
  startMs: number;
  endMs: number;
};

export type ZoomSegment = {
  startMs: number;
  endMs: number;
  focusX: number;
  focusY: number;
  scale: number;
};

export type DemoTimeline = {
  zoomSegments: ZoomSegment[];
  trimStartMs?: number;
  trimEndMs?: number;
};

export type ProductDemoInput = {
  recording: RecordingManifest;
  videoUrl: string;
  timeline: DemoTimeline;
  config: RenderConfig;
};
