import { z } from "zod";
import { viewportSchema } from "../recording/schema.js";

export const zoomConfigSchema = z.object({
  enabled: z.boolean(),
  clickClusterRadiusPx: z.number().positive(),
  clickClusterWindowMs: z.number().nonnegative(),
  zoomScale: z.number().min(1),
  enterDurationMs: z.number().nonnegative(),
  exitDurationMs: z.number().nonnegative(),
  paddingBeforeMs: z.number().nonnegative(),
  paddingAfterMs: z.number().nonnegative(),
});

export const demoVideoConfigSchema = z.object({
  recording: z.object({ viewport: viewportSchema }),
  render: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().int().positive(),
    padding: z.number().nonnegative(),
    paddingMode: z.enum(["minimum", "exact"]),
  }),
  cursor: z.object({ enabled: z.boolean() }),
  zoom: zoomConfigSchema,
});
