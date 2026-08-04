export const backgroundPresetNames = [
  "midnight",
  "ocean",
  "aurora",
  "prism",
  "daybreak",
  "tahoe",
] as const;

export type BackgroundPreset = (typeof backgroundPresetNames)[number];
export type GradientStop = { color: string; position?: number | undefined };

export type BackgroundOptions =
  | { type: "auto" }
  | { type: "preset"; name: BackgroundPreset }
  | { type: "color"; color: string }
  | {
      type: "gradient";
      kind?: "linear" | "radial" | undefined;
      angle?: number | undefined;
      stops: GradientStop[];
    };

export type ResolvedGradientStop = { color: string; position: number };
export type ResolvedBackground =
  | { type: "color"; color: string; source: "custom" }
  | {
      type: "gradient";
      kind: "linear" | "radial";
      angle: number;
      stops: ResolvedGradientStop[];
      source: "auto" | "custom" | BackgroundPreset;
    };

const presets: Record<
  BackgroundPreset,
  Omit<Extract<ResolvedBackground, { type: "gradient" }>, "source">
> = {
  midnight: {
    type: "gradient",
    kind: "linear",
    angle: 145,
    stops: [
      { color: "#253858", position: 0 },
      { color: "#111522", position: 0.52 },
      { color: "#0b1918", position: 1 },
    ],
  },
  ocean: {
    type: "gradient",
    kind: "linear",
    angle: 140,
    stops: [
      { color: "#164e63", position: 0 },
      { color: "#172554", position: 0.52 },
      { color: "#07111f", position: 1 },
    ],
  },
  aurora: {
    type: "gradient",
    kind: "linear",
    angle: 135,
    stops: [
      { color: "#4c1d95", position: 0 },
      { color: "#164e63", position: 0.52 },
      { color: "#052e2b", position: 1 },
    ],
  },
  prism: {
    type: "gradient",
    kind: "linear",
    angle: 118,
    stops: [
      { color: "#ff6b6b", position: 0 },
      { color: "#c44cff", position: 0.32 },
      { color: "#526dff", position: 0.66 },
      { color: "#18cde3", position: 1 },
    ],
  },
  daybreak: {
    type: "gradient",
    kind: "linear",
    angle: 132,
    stops: [
      { color: "#ff875e", position: 0 },
      { color: "#ffc766", position: 0.3 },
      { color: "#d488ff", position: 0.62 },
      { color: "#557dff", position: 1 },
    ],
  },
  tahoe: {
    type: "gradient",
    kind: "linear",
    angle: 122,
    stops: [
      { color: "#c9ccc5", position: 0 },
      { color: "#8eb4c9", position: 0.14 },
      { color: "#5e9acc", position: 0.29 },
      { color: "#377ac6", position: 0.43 },
      { color: "#1c4bc0", position: 0.58 },
      { color: "#123176", position: 0.72 },
      { color: "#051243", position: 0.86 },
      { color: "#376292", position: 1 },
    ],
  },
};

function positionedStops(stops: GradientStop[]): ResolvedGradientStop[] {
  const positions = stops.map((stop) => stop.position);
  positions[0] ??= 0;
  positions[positions.length - 1] ??= 1;
  let previous = 0;
  while (previous < positions.length - 1) {
    let next = previous + 1;
    while (positions[next] === undefined) next += 1;
    const start = positions[previous]!;
    const end = positions[next]!;
    for (let index = previous + 1; index < next; index += 1) {
      positions[index] = start + ((end - start) * (index - previous)) / (next - previous);
    }
    previous = next;
  }
  return stops.map((stop, index) => ({
    color: stop.color.toLowerCase(),
    position: positions[index]!,
  }));
}

export function resolveBackground(options?: BackgroundOptions): ResolvedBackground {
  if (!options) return { ...presets.tahoe, source: "tahoe" };
  if (options.type === "auto") return { ...presets.tahoe, source: "auto" };
  if (options.type === "preset") return { ...presets[options.name], source: options.name };
  if (options.type === "color") {
    return { type: "color", color: options.color.toLowerCase(), source: "custom" };
  }
  return {
    type: "gradient",
    kind: options.kind ?? "linear",
    angle: options.angle ?? 135,
    stops: positionedStops(options.stops),
    source: "custom",
  };
}
