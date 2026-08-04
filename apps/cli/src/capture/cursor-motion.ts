import type { MoveOptions } from "./types.js";

export type CursorPoint = { x: number; y: number };
export type CursorViewport = { width: number; height: number };
export type CursorBounds = CursorPoint & { width: number; height: number };

type CursorPathOptions = MoveOptions & {
  seed?: number;
  viewport?: CursorViewport;
  targetSizePx?: number;
};

const CURSOR_SAMPLE_RATE = 60;
const STRAIGHT_DISTANCE_PX = 40;
const FULL_CURVE_DISTANCE_PX = 280;
const MAX_CURVE_DEVIATION_PX = 80;
const MAX_TARGET_OFFSET_PX = 24;

function mix(seed: number, value: number): number {
  let result = (seed ^ Math.round(value * 1000)) >>> 0;
  result = Math.imul(result ^ (result >>> 16), 0x45d9f3b);
  result = Math.imul(result ^ (result >>> 16), 0x45d9f3b);
  return (result ^ (result >>> 16)) >>> 0;
}

function movementSeed(from: CursorPoint, to: CursorPoint, seed = 0): number {
  return [from.x, from.y, to.x, to.y].reduce(mix, seed >>> 0);
}

function randomUnit(seed: number): number {
  let value = (seed + 0x6d2b79f5) >>> 0;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function minimumJerk(time: number): number {
  return time * time * time * (10 + time * (-15 + time * 6));
}

function cubicBezier(
  from: CursorPoint,
  firstControl: CursorPoint,
  secondControl: CursorPoint,
  to: CursorPoint,
  progress: number,
): CursorPoint {
  const inverse = 1 - progress;
  const fromWeight = inverse * inverse * inverse;
  const firstWeight = 3 * inverse * inverse * progress;
  const secondWeight = 3 * inverse * progress * progress;
  const toWeight = progress * progress * progress;
  return {
    x:
      from.x * fromWeight +
      firstControl.x * firstWeight +
      secondControl.x * secondWeight +
      to.x * toWeight,
    y:
      from.y * fromWeight +
      firstControl.y * firstWeight +
      secondControl.y * secondWeight +
      to.y * toWeight,
  };
}

function clampPoint(point: CursorPoint, viewport: CursorViewport | undefined): CursorPoint {
  if (!viewport) return point;
  return {
    x: clamp(point.x, 0, viewport.width),
    y: clamp(point.y, 0, viewport.height),
  };
}

/** Selects a repeatable, safely inset point instead of always aiming at exact center. */
export function targetPointWithinBounds(
  bounds: CursorBounds,
  viewport: CursorViewport,
  seed = 0,
): CursorPoint {
  const left = clamp(bounds.x, 0, viewport.width);
  const top = clamp(bounds.y, 0, viewport.height);
  const right = clamp(bounds.x + bounds.width, 0, viewport.width);
  const bottom = clamp(bounds.y + bounds.height, 0, viewport.height);
  if (right <= left || bottom <= top) {
    throw new Error("Interaction target has no actionable area inside the viewport");
  }

  const width = right - left;
  const height = bottom - top;
  const centerX = left + width / 2;
  const centerY = top + height / 2;
  const offsetX = Math.min(MAX_TARGET_OFFSET_PX, width * 0.12);
  const offsetY = Math.min(MAX_TARGET_OFFSET_PX, height * 0.12);
  const baseSeed = [bounds.x, bounds.y, bounds.width, bounds.height].reduce(mix, seed >>> 0);
  return {
    x: centerX + (randomUnit(baseSeed) * 2 - 1) * offsetX,
    y: centerY + (randomUnit(mix(baseSeed, 1)) * 2 - 1) * offsetY,
  };
}

/** Builds a deterministic, subtly curved path with a human-like velocity profile. */
export function generateCursorPath(
  from: CursorPoint,
  to: CursorPoint,
  options: CursorPathOptions = {},
): { points: CursorPoint[]; durationMs: number } {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const distance = Math.hypot(deltaX, deltaY);
  const targetSize = Math.max(8, options.targetSizePx ?? 44);
  const durationMs =
    options.durationMs ??
    Math.max(260, Math.min(900, Math.round(180 + 150 * Math.log2(distance / targetSize + 1))));
  const steps =
    options.steps ?? Math.max(2, Math.ceil((durationMs / 1000) * CURSOR_SAMPLE_RATE) + 1);

  if (distance === 0) {
    return {
      durationMs,
      points: Array.from({ length: steps }, () => ({ ...to })),
    };
  }

  const seed = movementSeed(from, to, options.seed);
  const curveStrength = clamp(
    (distance - STRAIGHT_DISTANCE_PX) / (FULL_CURVE_DISTANCE_PX - STRAIGHT_DISTANCE_PX),
    0,
    1,
  );
  const preferredSign = randomUnit(seed) < 0.5 ? -1 : 1;
  const ratio = 0.07 + randomUnit(mix(seed, 2)) * 0.05;
  const deviation = Math.min(MAX_CURVE_DEVIATION_PX, distance * ratio * curveStrength);
  const normalX = (-deltaY / distance) * preferredSign;
  const normalY = (deltaX / distance) * preferredSign;
  const controlOffset = deviation / 0.75;
  const firstControl = clampPoint(
    {
      x: from.x + deltaX * 0.28 + normalX * controlOffset * 0.72,
      y: from.y + deltaY * 0.28 + normalY * controlOffset * 0.72,
    },
    options.viewport,
  );
  const secondControl = clampPoint(
    {
      x: from.x + deltaX * 0.72 + normalX * controlOffset,
      y: from.y + deltaY * 0.72 + normalY * controlOffset,
    },
    options.viewport,
  );

  const points = Array.from({ length: steps }, (_, index) => {
    const time = (index + 1) / steps;
    if (index === steps - 1) return { ...to };
    return clampPoint(
      cubicBezier(from, firstControl, secondControl, to, minimumJerk(time)),
      options.viewport,
    );
  });
  return { points, durationMs };
}
