import { z } from "zod";

const nonNegative = z.number().finite().nonnegative();
const coordinate = z.number().finite();

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

export const recordingEventSchema = z.discriminatedUnion("type", [
  cursorMoveEventSchema,
  clickEventSchema,
  navigationEventSchema,
]);

export const recordingManifestSchema = z
  .object({
    version: z.literal(1),
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
    events: z.array(recordingEventSchema),
  })
  .superRefine((manifest, context) => {
    if (manifest.video.durationMs !== manifest.durationMs) {
      context.addIssue({
        code: "custom",
        path: ["video", "durationMs"],
        message: "Video duration must match recording duration in manifest version 1",
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
