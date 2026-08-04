import type { ResolvedBackground } from "@noice-tech/demo-recorder-core";

type Rgb = readonly [number, number, number];
type RgbStop = { color: Rgb; position: number };
type PixelSampler = (x: number, y: number) => Rgb;

function parseHex(color: string): Rgb {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

function colorAt(stops: RgbStop[], position: number): Rgb {
  const endIndex = stops.findIndex((stop) => position <= stop.position);
  if (endIndex < 0) return stops.at(-1)!.color;
  if (endIndex === 0) return stops[0]!.color;

  const start = stops[endIndex - 1]!;
  const end = stops[endIndex]!;
  const progress = (position - start.position) / (end.position - start.position || 1);
  const mix = (channel: number) =>
    Math.round(start.color[channel]! + (end.color[channel]! - start.color[channel]!) * progress);
  return [mix(0), mix(1), mix(2)];
}

function createPixelSampler(
  width: number,
  height: number,
  background: ResolvedBackground,
): PixelSampler {
  if (background.type === "color") {
    const color = parseHex(background.color);
    return () => color;
  }

  const stops = background.stops.map((stop) => ({
    color: parseHex(stop.color),
    position: stop.position,
  }));
  const radians = (background.angle * Math.PI) / 180;
  const axisX = Math.sin(radians);
  const axisY = -Math.cos(radians);
  const extent = Math.abs(axisX) * width + Math.abs(axisY) * height;
  return (x, y) => {
    const projection = (x + 0.5 - width / 2) * axisX + (y + 0.5 - height / 2) * axisY;
    const position = Math.max(0, Math.min(1, 0.5 + projection / extent));
    return colorAt(stops, position);
  };
}

/** Generates a single binary PPM frame without browser or native image dependencies. */
export function generateBackgroundRaster(
  width: number,
  height: number,
  background: ResolvedBackground,
): Buffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("Background dimensions must be positive integers");
  }

  const header = Buffer.from(`P6\n${width} ${height}\n255\n`, "ascii");
  const pixels = Buffer.allocUnsafe(width * height * 3);
  const sample = createPixelSampler(width, height, background);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = sample(x, y);
      pixels[offset++] = color[0];
      pixels[offset++] = color[1];
      pixels[offset++] = color[2];
    }
  }
  return Buffer.concat([header, pixels]);
}
