import { z } from "zod";

const nonNegative = z.number().finite().nonnegative();
const coordinate = z.number().finite();
const modifierKeys = ["Control", "Alt", "Shift", "Meta"] as const;
const modifierOrder = new Map<string, number>(modifierKeys.map((key, index) => [key, index]));

export const viewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  deviceScaleFactor: z.number().positive().optional(),
});

export const interactionTargetSchema = z.object({
  role: z.string().optional(),
  name: z.string().optional(),
  selector: z.string().optional(),
  bounds: z
    .object({
      x: coordinate,
      y: coordinate,
      width: nonNegative,
      height: nonNegative,
    })
    .optional(),
});

export const cursorMoveEventSchema = z.object({
  type: z.literal("cursor-move"),
  timestampMs: nonNegative,
  x: coordinate,
  y: coordinate,
});

export const clickEventSchema = z.object({
  type: z.literal("click"),
  timestampMs: nonNegative,
  x: coordinate,
  y: coordinate,
  button: z.enum(["left", "middle", "right"]),
  target: interactionTargetSchema.optional(),
});

export const navigationEventSchema = z.object({
  type: z.literal("navigation"),
  timestampMs: nonNegative,
  url: z.url(),
});

export const keyPressEventSchema = z
  .object({
    type: z.literal("key-press"),
    timestampMs: nonNegative,
    keys: z.array(z.string().trim().min(1).max(50)).min(1).max(5),
  })
  .superRefine((event, context) => {
    const seen = new Set<string>();
    let previousModifier = -1;
    let ordinaryKeys = 0;
    for (const [index, key] of event.keys.entries()) {
      if (seen.has(key)) {
        context.addIssue({ code: "custom", path: ["keys", index], message: "Keys must be unique" });
      }
      seen.add(key);
      const order = modifierOrder.get(key);
      if (order === undefined) {
        ordinaryKeys += 1;
        if (index !== event.keys.length - 1) {
          context.addIssue({
            code: "custom",
            path: ["keys", index],
            message: "The non-modifier key must be last",
          });
        }
      } else {
        if (ordinaryKeys > 0 || order <= previousModifier) {
          context.addIssue({
            code: "custom",
            path: ["keys", index],
            message: "Modifiers must use canonical order",
          });
        }
        previousModifier = order;
      }
    }
    if (ordinaryKeys > 1) {
      context.addIssue({
        code: "custom",
        path: ["keys"],
        message: "A chord has at most one non-modifier key",
      });
    }
  });

export const recordingEventV1Schema = z.discriminatedUnion("type", [
  cursorMoveEventSchema,
  clickEventSchema,
  navigationEventSchema,
]);

export const recordingEventSchema = z.discriminatedUnion("type", [
  cursorMoveEventSchema,
  clickEventSchema,
  navigationEventSchema,
  keyPressEventSchema,
]);

const manifestFields = {
  id: z.string().min(1),
  createdAt: z.iso.datetime(),
  durationMs: nonNegative,
  viewport: viewportSchema,
  video: z.object({
    path: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    durationMs: nonNegative,
  }),
};

export const recordingManifestV1Schema = z.object({
  version: z.literal(1),
  ...manifestFields,
  events: z.array(recordingEventV1Schema),
});

export const recordingManifestV2Schema = z.object({
  version: z.literal(2),
  ...manifestFields,
  events: z.array(recordingEventSchema),
});

export const recordingManifestSchema = z
  .discriminatedUnion("version", [recordingManifestV1Schema, recordingManifestV2Schema])
  .superRefine((manifest, context) => {
    if (manifest.video.durationMs !== manifest.durationMs) {
      context.addIssue({
        code: "custom",
        path: ["video", "durationMs"],
        message: `Video duration must match recording duration in manifest version ${manifest.version}`,
      });
    }

    let previous = -1;
    manifest.events.forEach((event, index) => {
      if (event.timestampMs < previous) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "timestampMs"],
          message: "Events must be ordered by timestamp",
        });
      }
      if (event.timestampMs > manifest.durationMs) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "timestampMs"],
          message: "Event timestamp exceeds recording duration",
        });
      }
      if (
        (event.type === "cursor-move" || event.type === "click") &&
        (event.x < 0 ||
          event.x > manifest.viewport.width ||
          event.y < 0 ||
          event.y > manifest.viewport.height)
      ) {
        context.addIssue({
          code: "custom",
          path: ["events", index],
          message: "Interaction coordinates must be inside the recording viewport",
        });
      }
      previous = event.timestampMs;
    });
  });
