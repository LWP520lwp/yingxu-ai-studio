import type { ReactNode } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

type BatchFrameProps = {
  batchCount: number;
  batchExpanded: boolean;
  children: ReactNode;
};

/** A scale-independent SVG stack keeps its silhouette at every canvas zoom level. */
export function BatchFrame(props: BatchFrameProps) {
  const palette = canvasThemes[useThemeStore((state) => state.theme)].node;
  const layers = Math.min(3, Math.max(0, props.batchCount - 1));
  return (
    <div className="group/batch relative isolate size-full overflow-visible">
      {layers > 0 && (
        <svg
          aria-hidden="true"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 -z-10 size-full overflow-visible transition-opacity duration-200 motion-reduce:transition-none"
          style={{ opacity: props.batchExpanded ? 0 : 1 }}
        >
          {Array.from({ length: layers }, (_, i) => layers - i).map((depth) => (
            <rect
              key={depth}
              x={depth * 2.4}
              y={depth * 1.8}
              width="100"
              height="100"
              rx="3"
              fill={depth % 2 ? palette.panel : palette.fill}
              stroke={palette.stroke}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      )}
      {props.children}
    </div>
  );
}
