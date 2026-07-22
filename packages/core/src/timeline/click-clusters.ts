import type { ZoomConfig } from "../config/types.js";
import type { ClickEvent, RecordingEvent } from "../recording/types.js";
import type { ClickCluster } from "./types.js";

const distance = (a: Pick<ClickEvent, "x" | "y">, b: Pick<ClickEvent, "x" | "y">): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

function centerOf(clicks: readonly ClickEvent[]): { x: number; y: number } {
  return {
    x: clicks.reduce((sum, click) => sum + click.x, 0) / clicks.length,
    y: clicks.reduce((sum, click) => sum + click.y, 0) / clicks.length,
  };
}

function summarize(clicks: ClickEvent[]): ClickCluster {
  return {
    clicks,
    centerX: clicks.reduce((sum, click) => sum + click.x, 0) / clicks.length,
    centerY: clicks.reduce((sum, click) => sum + click.y, 0) / clicks.length,
    startMs: clicks[0]?.timestampMs ?? 0,
    endMs: clicks.at(-1)?.timestampMs ?? 0,
  };
}

export function clusterClicks(
  events: readonly RecordingEvent[],
  config: Pick<ZoomConfig, "clickClusterRadiusPx" | "clickClusterWindowMs">,
): ClickCluster[] {
  const clicks = events.filter((event): event is ClickEvent => event.type === "click");
  const clusters: ClickEvent[][] = [];

  for (const click of clicks) {
    const current = clusters.at(-1);
    const previous = current?.at(-1);
    const candidate = current ? [...current, click] : [click];
    const candidateCenter = centerOf(candidate);
    const isSpatiallyConsistent = candidate.every(
      (event) => distance(event, candidateCenter) <= config.clickClusterRadiusPx,
    );

    if (
      current &&
      previous &&
      click.timestampMs - previous.timestampMs <= config.clickClusterWindowMs &&
      isSpatiallyConsistent
    ) {
      current.push(click);
    } else {
      clusters.push([click]);
    }
  }

  return clusters.map(summarize);
}
