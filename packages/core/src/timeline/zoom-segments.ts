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

  const clicks = events.filter((event) => event.type === "click");
  const activeClicks = new Set(
    clicks.filter((click, index) => {
      const previous = clicks[index - 1];
      const next = clicks[index + 1];
      return (
        (previous && click.timestampMs - previous.timestampMs <= config.clickClusterWindowMs) ||
        (next && next.timestampMs - click.timestampMs <= config.clickClusterWindowMs)
      );
    }),
  );
  const clusters = clusterClicks(events, config).filter((cluster) =>
    cluster.clicks.some((click) => activeClicks.has(click)),
  );
  const segments = clusters.map((cluster) => ({
    startMs: Math.max(0, cluster.startMs - config.paddingBeforeMs),
    endMs: Math.min(durationMs, cluster.endMs + config.paddingAfterMs),
    focusX: cluster.centerX,
    focusY: cluster.centerY,
    scale: config.zoomScale,
  }));

  // Keep one camera session for nearby activity. A new spatial cluster pans the
  // camera; repeated clicks in the same area remain on the existing focus.
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1];
    const current = segments[index];
    const previousCluster = clusters[index - 1];
    const currentCluster = clusters[index];
    if (
      previous &&
      current &&
      previousCluster &&
      currentCluster &&
      currentCluster.startMs - previousCluster.endMs <= config.clickClusterWindowMs
    ) {
      const boundary = (current.startMs + previous.endMs) / 2;
      previous.endMs = boundary;
      current.startMs = boundary;
    }
  }

  return segments.filter((segment) => segment.endMs >= segment.startMs);
}
