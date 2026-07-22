import type { ZoomConfig } from "../config/types.js";
import type { RecordingEvent } from "../recording/types.js";
import { clusterClicks } from "./click-clusters.js";
import type { ZoomSegment } from "./types.js";

export function generateZoomSegments(
  events: readonly RecordingEvent[],
  durationMs: number,
  config: ZoomConfig,
): ZoomSegment[] {
  if (!config.enabled || durationMs <= 0) return [];

  const segments = clusterClicks(events, config).map((cluster) => ({
    startMs: Math.max(0, cluster.startMs - config.paddingBeforeMs),
    endMs: Math.min(durationMs, cluster.endMs + config.paddingAfterMs),
    focusX: cluster.centerX,
    focusY: cluster.centerY,
    scale: config.zoomScale,
  }));

  // Adjacent clusters keep distinct focal points. Split overlapping padding at
  // its midpoint so the composition never has two active camera segments.
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1];
    const current = segments[index];
    if (previous && current && current.startMs < previous.endMs) {
      const boundary = (current.startMs + previous.endMs) / 2;
      previous.endMs = boundary;
      current.startMs = boundary;
    }
  }

  return segments.filter((segment) => segment.endMs >= segment.startMs);
}
