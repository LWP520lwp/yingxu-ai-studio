import { useCallback, useEffect, useRef } from "react";

import {
  createCanvasNodeResizeGesture,
  resolveCanvasNodeResize,
  trackCanvasNodeResizePointer,
  type CanvasNodeResizeGesture,
} from "@/lib/canvas/canvas-node-resize-session";
import type { CanvasNodeData, Position } from "@/types/canvas";
import type { ResizeCorner } from "@/lib/canvas/canvas-node-resize";

type UseCanvasNodeResizeOptions = {
  node: CanvasNodeData;
  scale: number;
  keepAspectRatio: boolean;
  onResizeStart: (nodeId: string) => void;
  onResize: (
    nodeId: string,
    width: number,
    height: number,
    position?: Position,
  ) => void;
  onResizeEnd: (nodeId: string) => void;
};

export function useCanvasNodeResize({
  node,
  scale,
  keepAspectRatio,
  onResizeStart,
  onResize,
  onResizeEnd,
}: UseCanvasNodeResizeOptions) {
  const gestureRef = useRef<CanvasNodeResizeGesture | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const startResize = useCallback(
    (event: React.PointerEvent, corner: ResizeCorner) => {
      event.stopPropagation();
      event.preventDefault();
      cleanupRef.current?.();

      const gesture = createCanvasNodeResizeGesture(event.pointerId, {
        corner,
        pointerStart: { x: event.clientX, y: event.clientY },
        position: node.position,
        size: { width: node.width, height: node.height },
        scale,
        keepRatio: keepAspectRatio,
        ratio:
          (node.metadata?.naturalWidth || node.width) /
          (node.metadata?.naturalHeight || node.height || 1),
      });
      gestureRef.current = gesture;
      onResizeStart(node.id);

      cleanupRef.current = trackCanvasNodeResizePointer(
        window,
        event.pointerId,
        {
          onMove: (point) => {
            const result = resolveCanvasNodeResize(
              gestureRef.current,
              event.pointerId,
              point,
            );
            if (result)
              onResize(node.id, result.width, result.height, result.position);
          },
          onEnd: () => {
            if (gestureRef.current?.pointerId !== event.pointerId) return;
            gestureRef.current = null;
            cleanupRef.current = null;
            onResizeEnd(node.id);
          },
        },
      );
    },
    [keepAspectRatio, node, onResize, onResizeEnd, onResizeStart, scale],
  );

  useEffect(
    () => () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      gestureRef.current = null;
    },
    [],
  );

  return startResize;
}
