import {
  explorationObservationSummarySchema,
  type ExplorationObservation,
  type ExplorationObservationSummary,
} from "./interactive-schema.js";

const maximumSummaryElements = 20;

function intersectsViewport(
  element: ExplorationObservation["interactiveElements"][number],
  viewport: ExplorationObservation["viewport"],
): boolean {
  return (
    element.bounds.x < viewport.width &&
    element.bounds.x + element.bounds.width > 0 &&
    element.bounds.y < viewport.height &&
    element.bounds.y + element.bounds.height > 0
  );
}

export function summarizeExplorationObservation(
  observation: ExplorationObservation,
): ExplorationObservationSummary {
  const viewportElements = observation.interactiveElements.filter((element) =>
    intersectsViewport(element, observation.viewport),
  );
  const interactiveElements = viewportElements.slice(0, maximumSummaryElements).map((element) => ({
    ref: element.ref,
    ...(element.role ? { role: element.role } : {}),
    name: element.name,
    ...(element.href ? { href: element.href } : {}),
    enabled: element.enabled,
    ...(element.selected === undefined ? {} : { selected: element.selected }),
    ...(element.checked === undefined ? {} : { checked: element.checked }),
    ...(element.pressed === undefined ? {} : { pressed: element.pressed }),
    ...(element.expanded === undefined ? {} : { expanded: element.expanded }),
    bounds: element.bounds,
    risk: element.risk,
    riskReasons: element.riskReasons.slice(0, 3),
  }));
  return explorationObservationSummarySchema.parse({
    summaryVersion: 1,
    id: observation.id,
    stateId: observation.stateId,
    url: observation.url,
    pathname: observation.pathname,
    title: observation.title,
    viewport: observation.viewport,
    scroll: observation.scroll,
    headings: observation.headings.slice(0, 20),
    layers: observation.layers.slice(0, 20),
    interactiveElements,
    interactiveElementCounts: {
      total: observation.interactiveElements.length,
      viewport: viewportElements.length,
      returned: interactiveElements.length,
    },
    errors: observation.errors.slice(0, 10),
    artifacts: observation.artifacts,
    semanticFingerprint: observation.semanticFingerprint,
    settled: observation.settled,
  });
}
