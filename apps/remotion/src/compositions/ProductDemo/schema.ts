import { recordingManifestSchema } from "@noice-tech/demo-recorder-core/browser";
import { z } from "zod";

export const productDemoInputSchema = z
  .object({
    recording: recordingManifestSchema,
    videoUrl: z.string().min(1),
    timeline: z.object({
      zoomSegments: z.array(
        z
          .object({
            startMs: z.number().finite().nonnegative(),
            endMs: z.number().finite().nonnegative(),
            focusX: z.number().finite(),
            focusY: z.number().finite(),
            scale: z.number().min(1),
          })
          .refine((segment) => segment.endMs >= segment.startMs, {
            message: "Zoom segment end must not precede its start",
          }),
      ),
      trimStartMs: z.number().finite().nonnegative().optional(),
      trimEndMs: z.number().finite().positive().optional(),
    }),
    config: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      fps: z.number().int().positive(),
      cursorEnabled: z.boolean(),
      zoom: z.object({
        enterDurationMs: z.number().finite().nonnegative(),
        exitDurationMs: z.number().finite().nonnegative(),
      }),
    }),
  })
  .superRefine((input, context) => {
    const start = input.timeline.trimStartMs ?? 0;
    const end = input.timeline.trimEndMs ?? input.recording.durationMs;
    if (end <= start || end > input.recording.durationMs) {
      context.addIssue({
        code: "custom",
        path: ["timeline"],
        message: "Trim range must be ordered and inside the recording duration",
      });
    }
  });
