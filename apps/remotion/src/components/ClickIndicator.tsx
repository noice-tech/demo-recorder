import type { Point } from "@noice-tech/demo-recorder-core/browser";

export type ClickIndicatorProps = {
  position: Point;
  ageMs: number;
  durationMs?: number;
};

export function ClickIndicator({ position, ageMs, durationMs = 520 }: ClickIndicatorProps) {
  if (ageMs < 0 || ageMs > durationMs) return null;
  const progress = ageMs / durationMs;
  const eased = 1 - (1 - progress) * (1 - progress);
  const size = 18 + eased * 92;

  return (
    <div
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        width: size,
        height: size,
        border: `${Math.max(2, 4 - progress * 2)}px solid rgba(140, 240, 205, ${0.72 * (1 - progress)})`,
        borderRadius: "50%",
        boxShadow: `0 0 30px rgba(140, 240, 205, ${0.2 * (1 - progress)})`,
        transform: "translate(-50%, -50%)",
      }}
    />
  );
}
