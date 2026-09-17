import { z } from "zod";

export const viewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  deviceScaleFactor: z.number().positive().optional(),
});

export type Viewport = z.infer<typeof viewportSchema>;

const nonNegative = z.number().finite().nonnegative();
const coordinate = z.number().finite();
const stepNumber = z.number().int().positive();

const modifierKeys = ["Control", "Alt", "Shift", "Meta"] as const;
const modifierOrder = new Map<string, number>(modifierKeys.map((key, index) => [key, index]));

/** Rejects anything that is not a canonical key chord. */
export function isCanonicalChord(keys: readonly string[]): boolean {
  const seen = new Set<string>();
  let previousModifier = -1;
  let ordinary = 0;
  for (const [index, key] of keys.entries()) {
    if (seen.has(key)) return false;
    seen.add(key);
    const order = modifierOrder.get(key);
    if (order === undefined) {
      ordinary += 1;
      if (index !== keys.length - 1) return false;
    } else {
      if (ordinary > 0 || order <= previousModifier) return false;
      previousModifier = order;
    }
  }
  return ordinary <= 1;
}

export const keyChordSchema = z
  .array(z.string().trim().min(1).max(50))
  .min(1)
  .max(5)
  .refine(isCanonicalChord, "Keys must be a canonical chord");

export const eventTargetSchema = z.object({
  role: z.string().optional(),
  name: z.string().optional(),
  bounds: z
    .object({ x: coordinate, y: coordinate, width: nonNegative, height: nonNegative })
    .optional(),
});

export type EventTarget = z.infer<typeof eventTargetSchema>;

const eventFields = {
  timestampMs: nonNegative,
  step: stepNumber.optional(),
};

export const navigationEventSchema = z.object({
  type: z.literal("navigation"),
  ...eventFields,
  url: z.url(),
});

export const cursorMoveEventSchema = z.object({
  type: z.literal("cursor-move"),
  ...eventFields,
  x: coordinate,
  y: coordinate,
});

export const clickEventSchema = z.object({
  type: z.literal("click"),
  ...eventFields,
  x: coordinate,
  y: coordinate,
  button: z.enum(["left", "middle", "right"]).optional(),
  target: eventTargetSchema.optional(),
});

export const keyPressEventSchema = z.object({
  type: z.literal("key-press"),
  ...eventFields,
  keys: keyChordSchema,
});

export const scrollEventSchema = z.object({
  type: z.literal("scroll"),
  ...eventFields,
  deltaX: coordinate,
  deltaY: coordinate,
});

export const recordingEventSchema = z.discriminatedUnion("type", [
  navigationEventSchema,
  cursorMoveEventSchema,
  clickEventSchema,
  keyPressEventSchema,
  scrollEventSchema,
]);

export type NavigationEvent = z.infer<typeof navigationEventSchema>;
export type CursorMoveEvent = z.infer<typeof cursorMoveEventSchema>;
export type ClickEvent = z.infer<typeof clickEventSchema>;
export type KeyPressEvent = z.infer<typeof keyPressEventSchema>;
export type ScrollEvent = z.infer<typeof scrollEventSchema>;
export type RecordingEvent = z.infer<typeof recordingEventSchema>;

const knownEventTypes = new Set<string>([
  "navigation",
  "cursor-move",
  "click",
  "key-press",
  "scroll",
]);

/** Event types are additive: unknown types are ignored, malformed known ones are rejected. */
const recordingEventsSchema = z
  .array(z.unknown())
  .transform((events) =>
    events.filter(
      (event) =>
        typeof event === "object" &&
        event !== null &&
        knownEventTypes.has((event as { type?: unknown }).type as string),
    ),
  )
  .pipe(z.array(recordingEventSchema));

const interactionEvent = (event: RecordingEvent): event is ClickEvent | CursorMoveEvent =>
  event.type === "click" || event.type === "cursor-move";

export const recordingSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    createdAt: z.iso.datetime(),
    durationMs: nonNegative,
    viewport: viewportSchema,
    guarded: z.boolean(),
    cursor: z.enum(["synthetic", "embedded"]),
    video: z.object({
      path: z.string().min(1),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    events: recordingEventsSchema,
  })
  .superRefine((recording, context) => {
    let previous = -1;
    recording.events.forEach((event, index) => {
      if (event.timestampMs < previous) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "timestampMs"],
          message: "Events must be ordered by timestamp",
        });
      }
      if (event.timestampMs > recording.durationMs) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "timestampMs"],
          message: "Event timestamp exceeds recording duration",
        });
      }
      if (
        interactionEvent(event) &&
        (event.x < 0 ||
          event.x > recording.viewport.width ||
          event.y < 0 ||
          event.y > recording.viewport.height)
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

export type Recording = z.infer<typeof recordingSchema>;

export function parseRecording(input: unknown): Recording {
  return recordingSchema.parse(input);
}
