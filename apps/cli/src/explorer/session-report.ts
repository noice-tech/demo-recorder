import {
  explorationSessionReportSchema,
  type ExplorationLaunchConfig,
  type ExplorationObservation,
  type ExplorationSessionReport,
  type ExplorationVerificationReport,
} from "./interactive-schema.js";
import { sanitizeExplorationUrl } from "./privacy.js";

export function createExplorationSessionReport(options: {
  config: ExplorationLaunchConfig;
  createdAt: string;
  status: ExplorationSessionReport["status"];
  observations: number;
  states: number;
  transitions: number;
  actions: number;
  verifications: ExplorationVerificationReport[];
  latestObservation?: ExplorationObservation;
}): ExplorationSessionReport {
  const latestVerification = options.verifications.at(-1);
  return explorationSessionReportSchema.parse({
    schemaVersion: 2,
    id: options.config.id,
    createdAt: options.createdAt,
    ...(options.status === "active" ? {} : { finishedAt: new Date().toISOString() }),
    status: options.status,
    target: {
      baseUrl: sanitizeExplorationUrl(options.config.baseUrl),
      ...(options.config.repositoryPath ? { repositoryPath: options.config.repositoryPath } : {}),
    },
    ...(options.config.goal ? { goal: options.config.goal } : {}),
    policy: options.config.policy,
    limits: {
      maxActions: options.config.maxActions,
      maxDurationMs: options.config.maxDurationMs,
    },
    metrics: {
      observations: options.observations,
      states: options.states,
      transitions: options.transitions,
      actions: options.actions,
      verifications: options.verifications.length,
      verifiedPaths: options.verifications.filter(
        (verification) => verification.status === "passed",
      ).length,
    },
    ...(options.latestObservation ? { latestObservationId: options.latestObservation.id } : {}),
    ...(latestVerification
      ? {
          latestVerification: {
            id: latestVerification.id,
            status: latestVerification.status,
            report: latestVerification.artifacts.report,
          },
        }
      : {}),
  });
}

export function explorationSessionSummary(
  report: ExplorationSessionReport,
  latestObservation: ExplorationObservation | undefined,
  latestVerification: ExplorationVerificationReport | undefined,
): string {
  const lines = [
    `# Exploration: ${report.target.baseUrl}`,
    "",
    `Status: ${report.status}`,
    `Policy: ${report.policy}`,
    `Observations: ${report.metrics.observations}`,
    `States: ${report.metrics.states}`,
    `Transitions: ${report.metrics.transitions}`,
    "",
  ];
  if (latestObservation) {
    lines.push(
      "## Latest observation",
      "",
      `- ID: ${latestObservation.id}`,
      `- URL: ${latestObservation.url}`,
      `- Title: ${latestObservation.title}`,
      `- Headings: ${latestObservation.headings.join("; ") || "none"}`,
      `- Interactive elements: ${latestObservation.interactiveElements.length}`,
      `- Snapshot: ${latestObservation.artifacts.snapshot}`,
      `- Screenshot: ${latestObservation.artifacts.screenshot}`,
      "",
    );
  }
  if (latestVerification) {
    lines.push(
      "## Latest verification",
      "",
      `- ID: ${latestVerification.id}`,
      `- Status: ${latestVerification.status}`,
      `- Steps passed: ${latestVerification.steps.filter((step) => step.status === "passed").length}/${latestVerification.steps.length}`,
      `- Report: ${latestVerification.artifacts.report}`,
      ...(latestVerification.artifacts.trace
        ? [`- Trace: ${latestVerification.artifacts.trace}`]
        : []),
      ...(latestVerification.error ? [`- Error: ${latestVerification.error}`] : []),
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}
