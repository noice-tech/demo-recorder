import type { z } from "zod";
import type {
  clickEventSchema,
  cursorMoveEventSchema,
  interactionTargetSchema,
  keyPressEventSchema,
  navigationEventSchema,
  recordingEventSchema,
  recordingEventV1Schema,
  recordingManifestSchema,
  recordingManifestV1Schema,
  recordingManifestV2Schema,
  viewportSchema,
} from "./schema.js";

export type Viewport = z.infer<typeof viewportSchema>;
export type InteractionTarget = z.infer<typeof interactionTargetSchema>;
export type CursorMoveEvent = z.infer<typeof cursorMoveEventSchema>;
export type ClickEvent = z.infer<typeof clickEventSchema>;
export type NavigationEvent = z.infer<typeof navigationEventSchema>;
export type KeyPressEvent = z.infer<typeof keyPressEventSchema>;
export type RecordingEventV1 = z.infer<typeof recordingEventV1Schema>;
export type RecordingEvent = z.infer<typeof recordingEventSchema>;
export type RecordingManifestV1 = z.infer<typeof recordingManifestV1Schema>;
export type RecordingManifestV2 = z.infer<typeof recordingManifestV2Schema>;
export type RecordingManifest = z.infer<typeof recordingManifestSchema>;
