import type { Point } from "@noice-tech/demo-recorder-core/browser";

export type CursorProps = {
  position: Point;
  pressed: boolean;
};

export function Cursor({ position, pressed }: CursorProps) {
  return (
    <div
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        width: 24,
        height: 33,
        transform: `translate(-2px, -2px) scale(${pressed ? 0.84 : 1})`,
        transformOrigin: "4px 4px",
        filter: "drop-shadow(0 5px 8px rgba(0,0,0,0.38))",
      }}
    >
      <svg viewBox="0 0 24 33" width="100%" height="100%" fill="none">
        <path
          d="M1.5 1.5L1.7 26.1L7.8 20.8L12.4 31.6L16 30.1L11.5 19.1L21.5 18.8L1.5 1.5Z"
          fill="#080b10"
          stroke="white"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </svg>
    </div>
  );
}
