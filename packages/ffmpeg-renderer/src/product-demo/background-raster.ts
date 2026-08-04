import type { ResolvedBackground } from "@noice-tech/demo-recorder-core";

type Rgb = readonly [number, number, number];
type RgbStop = { color: Rgb; position: number };

function parseHex(color: string): Rgb {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

function channel(start: number, end: number, progress: number): number {
  return Math.round(start + (end - start) * progress);
}

function colorAt(stops: RgbStop[], position: number): Rgb {
  if (position <= stops[0]!.position) return stops[0]!.color;
  for (let index = 1; index < stops.length; index += 1) {
    const end = stops[index]!;
    if (position > end.position) continue;
    const start = stops[index - 1]!;
    const span = end.position - start.position;
    const progress = span === 0 ? 1 : (position - start.position) / span;
    return [
      channel(start.color[0], end.color[0], progress),
      channel(start.color[1], end.color[1], progress),
      channel(start.color[2], end.color[2], progress),
    ];
  }
  return stops.at(-1)!.color;
}

function gradientPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  angle: number,
): number {
  const dx = x + 0.5 - width / 2;
  const dy = y + 0.5 - height / 2;
  const radians = (angle * Math.PI) / 180;
  const axisX = Math.sin(radians);
  const axisY = -Math.cos(radians);
  const extent = Math.abs(axisX) * width + Math.abs(axisY) * height;
  return Math.max(0, Math.min(1, 0.5 + (dx * axisX + dy * axisY) / extent));
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
  const solid = background.type === "color" ? parseHex(background.color) : undefined;
  const gradient = background.type === "gradient" ? background : undefined;
  const gradientStops = gradient?.stops.map((stop) => ({
    color: parseHex(stop.color),
    position: stop.position,
  }));
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color =
        solid ?? colorAt(gradientStops!, gradientPosition(x, y, width, height, gradient!.angle));
      pixels[offset++] = color[0];
      pixels[offset++] = color[1];
      pixels[offset++] = color[2];
    }
  }
  return Buffer.concat([header, pixels]);
}
