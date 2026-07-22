import type { z } from "zod";
import type { demoVideoConfigSchema, zoomConfigSchema } from "./schema.js";

export type ZoomConfig = z.infer<typeof zoomConfigSchema>;
export type DemoVideoConfig = z.infer<typeof demoVideoConfigSchema>;
export type RenderConfig = DemoVideoConfig["render"] & {
  cursorEnabled: boolean;
  zoom: Pick<ZoomConfig, "enterDurationMs" | "exitDurationMs">;
};
