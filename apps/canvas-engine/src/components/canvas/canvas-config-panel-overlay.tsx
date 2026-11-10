import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { fitCanvasPanel } from "@/lib/canvas/canvas-panel-placement";

type Placement = ReturnType<typeof fitCanvasPanel> & { localLeft: number; localTop: number };

/** Keep the existing node overlay mounted while fitting it to the canvas viewport. */
export function CanvasConfigPanelOverlay({ nodeId, scale, width, children }: { nodeId: string; scale: number; width: number; children: ReactNode }) {
    const panelRef = useRef<HTMLDivElement>(null);
    const [placement, setPlacement] = useState<Placement | null>(null);

    useLayoutEffect(() => {
        const panel = panelRef.current;
        const node = panel?.parentElement;
        const viewport = panel?.closest<HTMLElement>("[data-canvas-viewport]");
        if (!panel || !node || !viewport) return;
        let frame: number | null = null;
        const measure = () => {
            frame = null;
            const nodeRect = node.getBoundingClientRect();
            const viewportRect = viewport.getBoundingClientRect();
            const dock = document.querySelector<HTMLElement>("[data-canvas-bottom-toolbar]")?.getBoundingClientRect();
            const fitted = fitCanvasPanel({ node: nodeRect, viewport: viewportRect, panelWidth: width, panelHeight: panel.scrollHeight,
                bottomInset: dock ? Math.max(0, viewportRect.bottom - dock.top) : 88 });
            const next = { ...fitted, localLeft: (fitted.left - nodeRect.left) / scale, localTop: (fitted.top - nodeRect.top) / scale };
            setPlacement((current) => current && Object.keys(next).every((key) => current[key as keyof Placement] === next[key as keyof Placement]) ? current : next);
        };
        const schedule = () => { if (frame === null) frame = requestAnimationFrame(measure); };
        measure();
        const resize = new ResizeObserver(schedule);
        resize.observe(viewport); resize.observe(node);
        if (panel.firstElementChild) resize.observe(panel.firstElementChild);
        const dock = document.querySelector<HTMLElement>("[data-canvas-bottom-toolbar]");
        if (dock) resize.observe(dock);
        const mutations = new MutationObserver(schedule);
        // Panning updates the existing world transform without rerendering every node.
        for (let ancestor: HTMLElement | null = node; ancestor && ancestor !== viewport; ancestor = ancestor.parentElement)
            mutations.observe(ancestor, { attributes: true, attributeFilter: ["style"] });
        window.addEventListener("resize", schedule);
        return () => { resize.disconnect(); mutations.disconnect(); window.removeEventListener("resize", schedule); if (frame !== null) cancelAnimationFrame(frame); };
    }, [nodeId, scale, width]);

    return <div ref={panelRef} data-node-panel={nodeId} data-canvas-no-zoom
        className="thin-scrollbar absolute z-[70] overflow-y-auto overscroll-contain rounded-2xl"
        style={{ left: placement?.localLeft ?? "50%", top: placement?.localTop ?? "100%", width: placement?.width ?? width,
            maxHeight: placement?.maxHeight, transform: placement ? `scale(${1 / scale})` : `translateX(-50%) scale(${1 / scale})`, transformOrigin: placement ? "top left" : "top center" }}
        onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
        {children}
    </div>;
}
