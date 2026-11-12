import type { ReactNode } from "react";

import { expandedBatchCardPosition } from "./slot-view-model";
import type { CanvasNodeData } from "@/types/canvas";
import type { CanvasTheme } from "@/lib/canvas-theme";

type BatchItemFrameProps = {
  node: CanvasNodeData;
  index: number;
  count: number;
  theme: CanvasTheme;
  bare?: boolean;
  onDoubleClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
  children: ReactNode;
};

export function BatchItemFrame({
  node,
  index,
  count,
  theme,
  bare = false,
  onDoubleClick,
  children,
}: BatchItemFrameProps) {
  const { x, y } = expandedBatchCardPosition(
    index,
    count,
    node.width,
    node.height,
  );

  return (
    <div
      className={`absolute z-20 overflow-hidden rounded-3xl ${bare ? "" : "border shadow-[0_18px_50px_rgba(28,25,23,.16)]"}`}
      style={
        {
          left: x,
          top: y,
          width: node.width,
          height: node.height,
          background: bare ? "transparent" : theme.node.panel,
          borderColor: theme.node.stroke,
          "--result-offset-x": `${-x}px`,
          "--result-offset-y": `${-y}px`,
          "--result-delay": `${Math.min(index, 8) * 24}ms`,
          animation: "atlas-result-reveal 240ms var(--result-delay) ease-out both",
        } as React.CSSProperties
      }
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={onDoubleClick}
    >
      {children}
    </div>
  );
}
