import type { z } from "zod";
import type {
  clickEventSchema,
  cursorMoveEventSchema,
  interactionTargetSchema,
  navigationEventSchema,
  recordingEventSchema,
  recordingManifestSchema,
  viewportSchema,
} from "./schema.js";

export type Viewport = z.infer<typeof viewportSchema>;
export type InteractionTarget = z.infer<typeof interactionTargetSchema>;
export type CursorMoveEvent = z.infer<typeof cursorMoveEventSchema>;
export type ClickEvent = z.infer<typeof clickEventSchema>;
export type NavigationEvent = z.infer<typeof navigationEventSchema>;
export type RecordingEvent = z.infer<typeof recordingEventSchema>;
export type RecordingManifest = z.infer<typeof recordingManifestSchema>;
