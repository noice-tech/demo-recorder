import { z } from "zod";
import { viewportSchema } from "./recording.js";

/** A durable, replayable way to find one element. Never contains a temporary `ref`. */
export const targetSchema = z
  .object({
    role: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    selector: z.string().min(1).optional(),
  })
  .refine((target) => target.role ?? target.name ?? target.selector, {
    message: "A target must include role, name, or selector",
  });

export type Target = z.infer<typeof targetSchema>;

/** Conditions that must all hold after a step runs. */
export const expectSchema = z.object({
  url: z.string().min(1).optional(),
  visible: targetSchema.optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export type Expect = z.infer<typeof expectSchema>;

export const constraintsSchema = z.object({
  submitForms: z.boolean().optional(),
  modifyData: z.boolean().optional(),
  sameOriginOnly: z.boolean().optional(),
});

export type Constraints = z.infer<typeof constraintsSchema>;

const planActionVariants = [
  z.strictObject({ type: z.literal("navigate"), url: z.string().min(1) }),
  z.strictObject({ type: z.literal("click"), target: targetSchema }),
  z.strictObject({ type: z.literal("fill"), target: targetSchema, value: z.string() }),
  z.strictObject({
    type: z.literal("press"),
    key: z.string().min(1),
    target: targetSchema.optional(),
  }),
  z.strictObject({ type: z.literal("select"), target: targetSchema, value: z.string() }),
  z.strictObject({
    type: z.literal("scroll"),
    deltaY: z.number().finite(),
    deltaX: z.number().finite().optional(),
  }),
  z.strictObject({ type: z.literal("hold"), durationMs: z.number().finite().nonnegative() }),
] as const;

/** A target-based action, used by plans and verification. */
export const planActionSchema = z.discriminatedUnion("type", planActionVariants);
export type PlanAction = z.infer<typeof planActionSchema>;

const stepMeta = {
  purpose: z.string().min(1).optional(),
  expect: expectSchema.optional(),
};

export const planStepSchema = z.discriminatedUnion("type", [
  planActionVariants[0].extend(stepMeta),
  planActionVariants[1].extend(stepMeta),
  planActionVariants[2].extend(stepMeta),
  planActionVariants[3].extend(stepMeta),
  planActionVariants[4].extend(stepMeta),
  planActionVariants[5].extend(stepMeta),
  planActionVariants[6].extend(stepMeta),
] as const);
export type PlanStep = z.infer<typeof planStepSchema>;

/** A ref-based action, valid only against the current observation. */
export const explorationActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("navigate"), url: z.string().min(1) }),
  z.object({
    type: z.literal("click"),
    observationId: z.string().min(1),
    ref: z.string().min(1),
  }),
  z.object({
    type: z.literal("fill"),
    observationId: z.string().min(1),
    ref: z.string().min(1),
    value: z.string(),
  }),
  z.object({
    type: z.literal("press"),
    key: z.string().min(1),
    observationId: z.string().min(1).optional(),
    ref: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("select"),
    observationId: z.string().min(1),
    ref: z.string().min(1),
    value: z.string(),
  }),
  z.object({
    type: z.literal("scroll"),
    deltaY: z.number().finite(),
    deltaX: z.number().finite().optional(),
  }),
  z.object({ type: z.literal("hold"), durationMs: z.number().finite().nonnegative() }),
] as const);

export type ExplorationAction = z.infer<typeof explorationActionSchema>;

export const actionSchema = z.union([planActionSchema, explorationActionSchema]);
export type Action = z.infer<typeof actionSchema>;

export const planSchema = z.strictObject({
  version: z.literal(1),
  name: z.string().min(1),
  goal: z.string().min(1),
  target: z.object({ baseUrl: z.url() }),
  viewport: viewportSchema,
  constraints: constraintsSchema.optional(),
  steps: z.array(planStepSchema).min(1),
});

export type Plan = z.infer<typeof planSchema>;

export function parsePlan(input: unknown): Plan {
  return planSchema.parse(input);
}
