import type { Rect } from "@noice-tech/demo-recorder-core/browser";
import type { ReactNode } from "react";

export const BROWSER_TITLE_BAR_HEIGHT = 48;

export type BrowserFrameProps = {
  rect: Rect;
  title?: string;
  children: ReactNode;
};

const controlColors = ["#ff5f57", "#febc2e", "#28c840"];

export function BrowserFrame({ rect, title = "Product demo", children }: BrowserFrameProps) {
  return (
    <div
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: 20,
        background: "#111522",
        boxShadow: "0 34px 90px rgba(0,0,0,0.48)",
      }}
    >
      <div
        style={{
          height: BROWSER_TITLE_BAR_HEIGHT,
          display: "flex",
          alignItems: "center",
          position: "relative",
          padding: "0 18px",
          background: "linear-gradient(180deg, #242a39 0%, #1a1f2c 100%)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div style={{ display: "flex", gap: 9 }}>
          {controlColors.map((color) => (
            <span
              key={color}
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: color,
                boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.15)",
              }}
            />
          ))}
        </div>
        <div
          style={{
            position: "absolute",
            left: "50%",
            transform: "translateX(-50%)",
            maxWidth: "55%",
            overflow: "hidden",
            color: "rgba(255,255,255,0.72)",
            fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
            fontSize: 14,
            fontWeight: 600,
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </div>
      </div>
      <div
        style={{
          position: "relative",
          width: rect.width,
          height: rect.height - BROWSER_TITLE_BAR_HEIGHT,
          overflow: "hidden",
          background: "#090b12",
        }}
      >
        {children}
      </div>
    </div>
  );
}
