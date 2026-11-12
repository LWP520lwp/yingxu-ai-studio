import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import {
  canvasPanelOverlayStyle,
  measureCanvasPanelOverlay,
  sameCanvasPanelPlacement,
  type CanvasPanelOverlayPlacement,
} from "@/lib/canvas/canvas-panel-overlay";

type CanvasConfigPanelOverlayProps = {
  nodeId: string;
  scale: number;
  width: number;
  children: ReactNode;
};

export function CanvasConfigPanelOverlay({
  nodeId,
  scale,
  width,
  children,
}: CanvasConfigPanelOverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] =
    useState<CanvasPanelOverlayPlacement | null>(null);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const node = panel?.parentElement;
    const viewport = panel?.closest<HTMLElement>("[data-canvas-viewport]");
    if (!panel || !node || !viewport) return;

    let animationFrame: number | null = null;
    const measure = () => {
      animationFrame = null;
      if (!panel.isConnected || !node.isConnected || !viewport.isConnected) {
        return;
      }

      const viewportRect = viewport.getBoundingClientRect();
      const dock = document
        .querySelector<HTMLElement>("[data-canvas-bottom-toolbar]")
        ?.getBoundingClientRect();
      const next = measureCanvasPanelOverlay({
        node: node.getBoundingClientRect(),
        viewport: viewportRect,
        panelWidth: width,
        panelHeight: panel.scrollHeight,
        scale,
        bottomInset: dock ? Math.max(0, viewportRect.bottom - dock.top) : 88,
      });

      setPlacement((current) =>
        sameCanvasPanelPlacement(current, next) ? current : next,
      );
    };

    const scheduleMeasure = () => {
      if (animationFrame === null) {
        animationFrame = window.requestAnimationFrame(measure);
      }
    };

    measure();

    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(viewport);
    resizeObserver.observe(node);
    resizeObserver.observe(panel);
    if (panel.firstElementChild)
      resizeObserver.observe(panel.firstElementChild);

    const dockElement = document.querySelector<HTMLElement>(
      "[data-canvas-bottom-toolbar]",
    );
    if (dockElement) resizeObserver.observe(dockElement);

    const transformObserver = new MutationObserver(scheduleMeasure);
    for (
      let ancestor: HTMLElement | null = node;
      ancestor && ancestor !== viewport;
      ancestor = ancestor.parentElement
    ) {
      transformObserver.observe(ancestor, {
        attributes: true,
        attributeFilter: ["style"],
      });
    }

    window.addEventListener("resize", scheduleMeasure);
    return () => {
      resizeObserver.disconnect();
      transformObserver.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [nodeId, scale, width]);

  return (
    <div
      ref={panelRef}
      data-node-panel={nodeId}
      data-canvas-no-zoom
      className="thin-scrollbar absolute z-[70] overflow-y-auto overscroll-contain rounded-2xl"
      style={canvasPanelOverlayStyle(placement, scale, width)}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}
