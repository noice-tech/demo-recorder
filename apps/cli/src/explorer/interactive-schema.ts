import { z } from "zod";
import { locatorMethodSchema } from "../browser/locator.js";

const nonempty = z.string().trim().min(1);
const boundedRegex = nonempty.max(200).refine(
  (value) => {
    try {
      const pattern = new RegExp(value);
      return pattern.source.length >= 0;
    } catch {
      return false;
    }
  },
  { message: "Invalid regular expression" },
);

// Launch-time configuration shared by the CLI client and detached session daemon.
export const explorationPolicySchema = z.enum(["read-only", "reversible"]);
export type ExplorationPolicyName = z.infer<typeof explorationPolicySchema>;

export const explorationLaunchConfigSchema = z.object({
  version: z.literal(1),
  id: nonempty,
  baseUrl: z.url(),
  outputDirectory: nonempty,
  headless: z.boolean(),
  policy: explorationPolicySchema,
  maxActions: z.number().int().positive().max(500),
  maxDurationMs: z
    .number()
    .int()
    .positive()
    .max(60 * 60_000),
  repositoryPath: nonempty.optional(),
  startCommand: nonempty.optional(),
  readinessUrl: z.url().optional(),
  storageStatePath: nonempty.optional(),
  sessionStoragePath: nonempty.optional(),
  authProfile: nonempty.optional(),
  goal: nonempty.max(2_000).optional(),
});
export type ExplorationLaunchConfig = z.infer<typeof explorationLaunchConfigSchema>;

export const explorationLocatorMethodSchema = locatorMethodSchema;

export type ExplorationLocatorMethod = z.infer<typeof explorationLocatorMethodSchema>;

// Durable evidence recorded for each observed control. Refs are session-local; locator recipes
// are persisted so verification and plan export can replay the interaction later.
export const explorationTargetRecipeSchema = z.object({
  description: nonempty,
  candidates: z.array(explorationLocatorMethodSchema).min(1).max(5),
  expected: z.object({
    role: nonempty.optional(),
    accessibleName: nonempty.optional(),
    count: z.number().int().nonnegative().optional(),
  }),
});
export type ExplorationTargetRecipe = z.infer<typeof explorationTargetRecipeSchema>;

export const exploredInteractiveElementSchema = z.object({
  ref: nonempty,
  role: nonempty.optional(),
  name: z.string(),
  tagName: nonempty,
  href: z.string().optional(),
  inputType: z.string().optional(),
  visible: z.boolean(),
  enabled: z.boolean(),
  selected: z.boolean().optional(),
  checked: z.boolean().optional(),
  pressed: z.boolean().optional(),
  expanded: z.boolean().optional(),
  bounds: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
  }),
  risk: z.enum(["read-only", "reversible", "destructive", "external-side-effect", "unknown"]),
  riskReasons: z.array(z.string()),
  target: explorationTargetRecipeSchema,
});
export type ExploredInteractiveElementV2 = z.infer<typeof exploredInteractiveElementSchema>;

export const explorationObservationSchema = z.object({
  schemaVersion: z.literal(2),
  id: nonempty,
  sequence: z.number().int().positive(),
  stateId: nonempty,
  reason: nonempty,
  createdAt: z.string(),
  url: z.string(),
  pathname: z.string(),
  title: z.string(),
  viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  scroll: z.object({ x: z.number().finite(), y: z.number().finite() }),
  headings: z.array(z.string()),
  layers: z.array(z.object({ role: z.string(), name: z.string() })),
  interactiveElements: z.array(exploredInteractiveElementSchema),
  errors: z.array(z.string()),
  artifacts: z.object({ snapshot: nonempty, screenshot: nonempty, observation: nonempty }),
  semanticFingerprint: nonempty,
  settled: z.object({
    reason: z.enum(["initial", "quiet", "timed-out", "explicit"]),
    durationMs: z.number().nonnegative(),
  }),
});
export type ExplorationObservation = z.infer<typeof explorationObservationSchema>;

export const explorationSummaryElementSchema = z.object({
  ref: nonempty,
  role: nonempty.optional(),
  name: z.string(),
  href: z.string().optional(),
  enabled: z.boolean(),
  selected: z.boolean().optional(),
  checked: z.boolean().optional(),
  pressed: z.boolean().optional(),
  expanded: z.boolean().optional(),
  bounds: exploredInteractiveElementSchema.shape.bounds,
  risk: exploredInteractiveElementSchema.shape.risk,
  riskReasons: z.array(z.string()).max(3),
});
export type ExplorationSummaryElement = z.infer<typeof explorationSummaryElementSchema>;

export const explorationObservationSummarySchema = z.object({
  summaryVersion: z.literal(1),
  id: nonempty,
  stateId: nonempty,
  url: z.string(),
  pathname: z.string(),
  title: z.string(),
  viewport: explorationObservationSchema.shape.viewport,
  scroll: explorationObservationSchema.shape.scroll,
  headings: z.array(z.string()).max(20),
  layers: z.array(z.object({ role: z.string(), name: z.string() })).max(20),
  interactiveElements: z.array(explorationSummaryElementSchema).max(20),
  interactiveElementCounts: z.object({
    total: z.number().int().nonnegative(),
    viewport: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
  }),
  errors: z.array(z.string()).max(10),
  artifacts: explorationObservationSchema.shape.artifacts,
  semanticFingerprint: nonempty,
  settled: explorationObservationSchema.shape.settled,
});
export type ExplorationObservationSummary = z.infer<typeof explorationObservationSummarySchema>;

// Commands accepted by the interactive session API.
export const explorationActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("click"),
    observationId: nonempty,
    ref: nonempty,
    reason: nonempty.max(500).optional(),
  }),
  z.object({
    type: z.literal("hover"),
    observationId: nonempty,
    ref: nonempty,
    reason: nonempty.max(500).optional(),
  }),
  z.object({ type: z.literal("goto"), url: nonempty, reason: nonempty.max(500).optional() }),
  z.object({ type: z.literal("back"), reason: nonempty.max(500).optional() }),
  z.object({
    type: z.literal("scroll"),
    deltaX: z.number().finite().default(0),
    deltaY: z.number().finite(),
    reason: nonempty.max(500).optional(),
  }),
  z.object({
    type: z.literal("scroll-until-text"),
    text: nonempty.max(500),
    direction: z.enum(["up", "down"]).default("down"),
    stepPx: z.number().int().min(100).max(2_000).default(700),
    maxSteps: z.number().int().min(1).max(20).default(10),
    reason: nonempty.max(500).optional(),
  }),
  z.object({
    type: z.literal("scroll-until-regex"),
    regex: boundedRegex,
    direction: z.enum(["up", "down"]).default("down"),
    stepPx: z.number().int().min(100).max(2_000).default(700),
    maxSteps: z.number().int().min(1).max(20).default(10),
    reason: nonempty.max(500).optional(),
  }),
  z.object({
    type: z.literal("wait"),
    durationMs: z.number().int().positive().max(10_000),
    reason: nonempty.max(500).optional(),
  }),
]);
export type ExplorationAction = z.infer<typeof explorationActionSchema>;

export const explorationFindQuerySchema = z
  .object({
    text: z.string().trim().min(1).max(500).optional(),
    regex: boundedRegex.optional(),
  })
  .refine((query) => Boolean(query.text) !== Boolean(query.regex), {
    message: "Provide exactly one of text or regex",
  });
export type ExplorationFindQuery = z.infer<typeof explorationFindQuerySchema>;

export const explorationFindResultSchema = z.object({
  observationId: nonempty,
  matches: z
    .array(
      z.object({
        kind: z.enum(["element", "heading", "layer", "text"]),
        ref: z.string().optional(),
        role: z.string().optional(),
        text: z.string(),
        context: z.array(z.string()).max(4).optional(),
        risk: exploredInteractiveElementSchema.shape.risk.optional(),
      }),
    )
    .max(50),
});
export type ExplorationFindResult = z.infer<typeof explorationFindResultSchema>;

export const explorationSemanticDiffSchema = z.object({
  urlChanged: z.boolean(),
  titleChanged: z.boolean(),
  headingsAdded: z.array(z.string()),
  headingsRemoved: z.array(z.string()),
  layersAdded: z.array(z.string()),
  layersRemoved: z.array(z.string()),
  controlsAdded: z.array(z.string()),
  controlsRemoved: z.array(z.string()),
});
export type ExplorationSemanticDiff = z.infer<typeof explorationSemanticDiffSchema>;

export const explorationTransitionSchema = z.object({
  schemaVersion: z.literal(2),
  id: nonempty,
  sequence: z.number().int().positive(),
  createdAt: z.string(),
  action: explorationActionSchema,
  status: z.enum(["succeeded", "blocked", "failed"]),
  policy: z.object({
    allowed: z.boolean(),
    risk: exploredInteractiveElementSchema.shape.risk,
    reasons: z.array(z.string()),
  }),
  fromObservationId: nonempty,
  fromStateId: nonempty,
  toObservationId: nonempty.optional(),
  toStateId: nonempty.optional(),
  target: explorationTargetRecipeSchema.optional(),
  diff: explorationSemanticDiffSchema.optional(),
  outcome: z.object({
    urlChanged: z.boolean(),
    semanticChanged: z.boolean(),
    popupBlocked: z.boolean(),
    downloadBlocked: z.boolean(),
    dialogDismissed: z.boolean(),
    settledReason: z.enum(["quiet", "timed-out", "explicit"]).optional(),
  }),
  durationMs: z.number().nonnegative(),
  error: z.string().optional(),
});
export type ExplorationTransition = z.infer<typeof explorationTransitionSchema>;

export const explorationActionResultSchema = z.object({
  transition: explorationTransitionSchema,
  observation: explorationObservationSchema,
});
export type ExplorationActionResult = z.infer<typeof explorationActionResultSchema>;

export const explorationGraphSchema = z.object({
  schemaVersion: z.literal(2),
  states: z.array(
    z.object({
      id: nonempty,
      fingerprint: nonempty,
      canonicalObservationId: nonempty,
      observationIds: z.array(nonempty).min(1),
    }),
  ),
  observations: z.array(
    z.object({
      id: nonempty,
      stateId: nonempty,
      sequence: z.number().int().positive(),
    }),
  ),
  transitions: z.array(
    z.object({
      id: nonempty,
      status: z.enum(["succeeded", "blocked", "failed"]),
      fromStateId: nonempty,
      toStateId: nonempty.optional(),
    }),
  ),
});
export type ExplorationGraph = z.infer<typeof explorationGraphSchema>;

// Fresh-context replay contracts. A successful report is the prerequisite for plan export.
export const explorationVerificationRequestSchema = z.object({
  version: z.literal(1),
  transitionIds: z
    .array(nonempty)
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, "Transition IDs must be unique"),
});
export type ExplorationVerificationRequest = z.infer<typeof explorationVerificationRequestSchema>;

const verificationExpectedSchema = z.object({
  observationId: nonempty,
  stateId: nonempty,
  semanticFingerprint: nonempty,
  url: z.string(),
});

export const explorationVerificationReportSchema = z.object({
  schemaVersion: z.literal(1),
  id: nonempty,
  createdAt: z.string(),
  finishedAt: z.string(),
  status: z.enum(["passed", "failed"]),
  error: z.string().optional(),
  request: explorationVerificationRequestSchema,
  steps: z.array(
    z.object({
      sequence: z.number().int().positive(),
      transitionId: nonempty,
      action: explorationActionSchema,
      status: z.enum(["passed", "failed"]),
      candidateUsed: explorationLocatorMethodSchema.optional(),
      expected: verificationExpectedSchema,
      actual: z
        .object({
          semanticFingerprint: nonempty,
          url: z.string(),
        })
        .optional(),
      durationMs: z.number().nonnegative(),
      screenshot: nonempty.optional(),
      error: z.string().optional(),
    }),
  ),
  artifacts: z.object({ report: nonempty, trace: nonempty.optional() }),
});
export type ExplorationVerificationReport = z.infer<typeof explorationVerificationReportSchema>;

export const explorationDraftPlanRequestSchema = z.object({
  version: z.literal(1),
  verificationId: nonempty,
  name: nonempty.regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  goal: nonempty.max(2_000),
  audience: nonempty.max(500).optional(),
  targetDurationMs: z
    .number()
    .int()
    .positive()
    .max(30 * 60_000)
    .optional(),
  includeUrlState: z.boolean().optional(),
});
export type ExplorationDraftPlanRequest = z.infer<typeof explorationDraftPlanRequestSchema>;

// Small status documents used for daemon discovery and CLI polling.
export const explorationSessionReportSchema = z.object({
  schemaVersion: z.literal(2),
  id: nonempty,
  createdAt: z.string(),
  finishedAt: z.string().optional(),
  status: z.enum(["active", "finished", "aborted", "failed"]),
  target: z.object({ baseUrl: z.string(), repositoryPath: z.string().optional() }),
  goal: z.string().optional(),
  policy: explorationPolicySchema,
  limits: z.object({
    maxActions: z.number().int().positive(),
    maxDurationMs: z.number().int().positive(),
  }),
  metrics: z.object({
    observations: z.number().int().nonnegative(),
    states: z.number().int().nonnegative(),
    transitions: z.number().int().nonnegative(),
    actions: z.number().int().nonnegative(),
    verifications: z.number().int().nonnegative().default(0),
    verifiedPaths: z.number().int().nonnegative().default(0),
  }),
  latestObservationId: z.string().optional(),
  latestVerification: z
    .object({
      id: nonempty,
      status: z.enum(["passed", "failed"]),
      report: nonempty,
    })
    .optional(),
});
export type ExplorationSessionReport = z.infer<typeof explorationSessionReportSchema>;

export const explorationSessionDescriptorSchema = z.object({
  version: z.literal(1),
  id: nonempty,
  pid: z.number().int().positive(),
  port: z.number().int().positive(),
  token: nonempty,
  outputDirectory: nonempty,
  launchConfigPath: nonempty,
});
export type ExplorationSessionDescriptor = z.infer<typeof explorationSessionDescriptorSchema>;
