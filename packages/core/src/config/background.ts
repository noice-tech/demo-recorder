export const backgroundPresetNames = [
  "midnight",
  "ocean",
  "aurora",
  "prism",
  "daybreak",
  "tahoe",
] as const;

export type BackgroundPreset = (typeof backgroundPresetNames)[number];
export type BackgroundOptions =
  | { type: "preset"; name: BackgroundPreset }
  | { type: "color"; color: string }
  | { type: "gradient"; angle?: number | undefined; colors: string[] };

export type ResolvedGradientStop = { color: string; position: number };
export type ResolvedBackground =
  | { type: "color"; color: string }
  | { type: "gradient"; angle: number; stops: ResolvedGradientStop[] };

type PresetDefinition = Omit<Extract<ResolvedBackground, { type: "gradient" }>, "type">;

const presets: Record<BackgroundPreset, PresetDefinition> = {
  midnight: {
    angle: 145,
    stops: [
      { color: "#253858", position: 0 },
      { color: "#111522", position: 0.52 },
      { color: "#0b1918", position: 1 },
    ],
  },
  ocean: {
    angle: 140,
    stops: [
      { color: "#164e63", position: 0 },
      { color: "#172554", position: 0.52 },
      { color: "#07111f", position: 1 },
    ],
  },
  aurora: {
    angle: 135,
    stops: [
      { color: "#4c1d95", position: 0 },
      { color: "#164e63", position: 0.52 },
      { color: "#052e2b", position: 1 },
    ],
  },
  prism: {
    angle: 118,
    stops: [
      { color: "#ff6b6b", position: 0 },
      { color: "#c44cff", position: 0.32 },
      { color: "#526dff", position: 0.66 },
      { color: "#18cde3", position: 1 },
    ],
  },
  daybreak: {
    angle: 132,
    stops: [
      { color: "#ff875e", position: 0 },
      { color: "#ffc766", position: 0.3 },
      { color: "#d488ff", position: 0.62 },
      { color: "#557dff", position: 1 },
    ],
  },
  tahoe: {
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

export function resolveBackground(options?: BackgroundOptions): ResolvedBackground {
  const selected: BackgroundOptions = options ?? { type: "preset", name: "tahoe" };
  switch (selected.type) {
    case "preset":
      return { type: "gradient", ...presets[selected.name] };
    case "color":
      return { type: "color", color: selected.color.toLowerCase() };
    case "gradient":
      return {
        type: "gradient",
        angle: selected.angle ?? 135,
        stops: selected.colors.map((color, index) => ({
          color: color.toLowerCase(),
          position: index / (selected.colors.length - 1),
        })),
      };
  }
}
