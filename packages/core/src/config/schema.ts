import { z } from "zod";
import { viewportSchema } from "../recording/schema.js";
import { backgroundPresetNames } from "./background.js";

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Expected a #RRGGBB color");
export const backgroundOptionsSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("preset"), name: z.enum(backgroundPresetNames) }),
  z.object({ type: z.literal("color"), color: hexColorSchema }),
  z.object({
    type: z.literal("gradient"),
    angle: z.number().finite().optional(),
    colors: z.array(hexColorSchema).min(2).max(4),
  }),
]);

export const resolvedBackgroundSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("color"), color: hexColorSchema }),
  z.object({
    type: z.literal("gradient"),
    angle: z.number().finite(),
    stops: z.array(z.object({ color: hexColorSchema, position: z.number().min(0).max(1) })).min(2),
  }),
]);

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
    background: resolvedBackgroundSchema,
  }),
  cursor: z.object({ enabled: z.boolean() }),
  zoom: zoomConfigSchema,
});
