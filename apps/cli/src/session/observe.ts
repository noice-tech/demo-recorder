import { join } from "node:path";
import { z } from "zod";
import { viewportSchema } from "@noice-tech/demo-recorder-core";
import type { Session } from "../driver/types.js";
import { readJson, writeFileAtomic, writeJsonAtomic } from "../support/files.js";

/** A ref from the observation's snapshot, kept to confirm it still means the same element. */
export const observationElementSchema = z.object({
  ref: z.string().min(1),
  role: z.string().min(1),
  name: z.string().min(1).optional(),
  path: z.array(z.number().int().nonnegative()),
});

export const observationSchema = z.object({
  id: z.string().min(1),
  createdAt: z.iso.datetime(),
  url: z.string(),
  title: z.string(),
  viewport: viewportSchema,
  scroll: z.object({ x: z.number().finite(), y: z.number().finite() }),
  snapshot: z.string(),
  elements: z.array(observationElementSchema),
  errors: z.array(z.string()),
  artifacts: z.object({ snapshot: z.string(), screenshot: z.string() }),
});

export type Observation = z.infer<typeof observationSchema>;
export type ObservationElement = z.infer<typeof observationElementSchema>;

export function observationPath(project: string, id: string): string {
  return join(project, "observations", `${id}.json`);
}

export async function readObservation(project: string, id: string): Promise<Observation> {
  return observationSchema.parse(await readJson(observationPath(project, id)));
}

export async function observe(input: {
  project: string;
  session: Session;
  viewport: { width: number; height: number };
  id: string;
}): Promise<Observation> {
  const { project, session, viewport, id } = input;
  const snapshotRelative = `observations/${id}.yml`;
  const screenshotRelative = `observations/${id}.png`;
  const [inspection] = await Promise.all([
    session.inspect(),
    session.screenshot(join(project, screenshotRelative)),
  ]);
  await writeFileAtomic(join(project, snapshotRelative), inspection.snapshot);

  const observation = observationSchema.parse({
    id,
    createdAt: new Date().toISOString(),
    url: inspection.url,
    title: inspection.title,
    viewport,
    scroll: inspection.scroll,
    snapshot: inspection.snapshot,
    elements: inspection.elements,
    errors: inspection.errors,
    artifacts: { snapshot: snapshotRelative, screenshot: screenshotRelative },
  });
  await writeJsonAtomic(observationPath(project, id), observation);
  return observation;
}
