import { viewportSchema } from "@noice-tech/demo-recorder-core";
import { z } from "zod";
import { locatorMethodSchema } from "../browser/locator.js";

const nonempty = z.string().trim().min(1);

export const locatorSchema = z.object({
  primary: locatorMethodSchema,
  fallbacks: z.array(locatorMethodSchema).max(3).optional(),
});

const purpose = nonempty.max(500).optional();
const actionBase = { purpose };
export const demoActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("navigate"), url: nonempty, ...actionBase }),
  z.object({
    type: z.literal("move"),
    locator: locatorSchema,
    durationMs: z.number().int().positive().optional(),
    ...actionBase,
  }),
  z.object({
    type: z.literal("click"),
    locator: locatorSchema,
    button: z.enum(["left", "middle", "right"]).optional(),
    ...actionBase,
  }),
  z.object({
    type: z.literal("fill"),
    locator: locatorSchema,
    value: z.string().max(10_000),
    ...actionBase,
  }),
  z.object({
    type: z.literal("press"),
    locator: locatorSchema,
    key: nonempty.max(100),
    ...actionBase,
  }),
  z.object({
    type: z.literal("select"),
    locator: locatorSchema,
    value: nonempty.max(500),
    ...actionBase,
  }),
  z.object({
    type: z.literal("scroll"),
    deltaX: z.number().finite().optional(),
    deltaY: z.number().finite(),
    ...actionBase,
  }),
  z.object({
    type: z.literal("wait-for"),
    locator: locatorSchema,
    timeoutMs: z.number().int().positive().optional(),
    ...actionBase,
  }),
  z.object({
    type: z.literal("assert-visible"),
    locator: locatorSchema,
    timeoutMs: z.number().int().positive().optional(),
    ...actionBase,
  }),
  z.object({
    type: z.literal("wait-for-url"),
    urlPattern: nonempty,
    timeoutMs: z.number().int().positive().optional(),
    ...actionBase,
  }),
  z.object({
    type: z.literal("hold"),
    durationMs: z.number().int().positive().max(60_000),
    ...actionBase,
  }),
]);

export const demoBriefSchema = z.object({
  goal: nonempty.max(2_000),
  audience: nonempty.max(500).optional(),
  targetDurationMs: z
    .number()
    .int()
    .positive()
    .max(30 * 60_000)
    .optional(),
  constraints: z
    .object({
      submitForms: z.boolean().default(false),
      modifyData: z.boolean().default(false),
      sameOriginOnly: z.boolean().default(true),
    })
    .default({ submitForms: false, modifyData: false, sameOriginOnly: true }),
});

export const plannedZoomSchema = z
  .object({
    startMs: z.number().nonnegative(),
    endMs: z.number().positive(),
    focusX: z.number().nonnegative(),
    focusY: z.number().nonnegative(),
    scale: z.number().min(1),
  })
  .refine((zoom) => zoom.endMs > zoom.startMs, "Zoom end must follow its start");

export const presentationCanvasSchema = z
  .object({
    aspectRatio: z
      .string()
      .regex(/^(?:source|\d+(?:\.\d+)?:\d+(?:\.\d+)?)$/)
      .optional(),
    width: z.number().int().positive().max(7680).optional(),
    height: z.number().int().positive().max(7680).optional(),
    padding: z.number().int().nonnegative().max(2000).optional(),
  })
  .refine(
    (canvas) => {
      if (!canvas.aspectRatio || canvas.aspectRatio === "source") return true;
      const [width, height] = canvas.aspectRatio.split(":").map(Number);
      return Boolean(width && height && width > 0 && height > 0);
    },
    { message: "Canvas aspect ratio values must be positive" },
  )
  .refine((canvas) => (canvas.width === undefined) === (canvas.height === undefined), {
    message: "Canvas width and height must be specified together",
  })
  .refine((canvas) => canvas.aspectRatio === undefined || canvas.width === undefined, {
    message: "Use either canvas aspectRatio or explicit width and height",
  });

export const demoPlanSchema = z.object({
  version: z.literal(1),
  name: nonempty.regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  brief: demoBriefSchema,
  target: z.object({
    baseUrl: z.url(),
    repositoryPath: nonempty.optional(),
    startCommand: nonempty.optional(),
    readinessUrl: z.url().optional(),
    authProfile: nonempty.optional(),
  }),
  capture: z.object({
    viewport: viewportSchema.optional(),
    steps: z.array(demoActionSchema).min(1).max(500),
  }),
  presentation: z
    .object({
      beats: z
        .array(
          z.object({
            label: nonempty.max(200),
            importance: z.enum(["primary", "secondary"]).default("secondary"),
          }),
        )
        .default([]),
      zoomSegments: z.array(plannedZoomSchema).optional(),
      trimStartMs: z.number().nonnegative().optional(),
      trimEndMs: z.number().positive().optional(),
      canvas: presentationCanvasSchema.optional(),
    })
    .refine(
      (presentation) =>
        presentation.trimStartMs === undefined ||
        presentation.trimEndMs === undefined ||
        presentation.trimEndMs > presentation.trimStartMs,
      "Presentation trim end must follow its start",
    )
    .default({ beats: [] }),
});
