import React, { useMemo } from "react";

import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { useCanvasViewportInput } from "@/pages/canvas/hooks/use-canvas-viewport-input";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ViewportTransform } from "@/types/canvas";

type InfiniteCanvasProps = {
    containerRef: React.RefObject<HTMLDivElement | null>;
    viewport: ViewportTransform;
    tool: "select" | "pan";
    backgroundMode?: CanvasBackgroundMode;
    onViewportChange: (viewport: ViewportTransform) => void;
    onCanvasMouseDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
    onCanvasDeselect?: () => void;
    onCanvasDoubleClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
    onContextMenu?: (event: React.MouseEvent) => void;
    onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
    children: React.ReactNode;
};

export function InfiniteCanvas({
    containerRef,
    viewport,
    tool,
    backgroundMode = "lines",
    onViewportChange,
    onCanvasMouseDown,
    onCanvasDeselect,
    onCanvasDoubleClick,
    onContextMenu,
    onDrop,
    children,
}: InfiniteCanvasProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const input = useCanvasViewportInput({ containerRef, viewport, tool, onViewportChange, onCanvasMouseDown, onCanvasDeselect, onCanvasDoubleClick });

    return (
        <div
            ref={containerRef}
            data-canvas-viewport
            className="canvas-atlas-viewport relative h-full w-full select-none overflow-hidden"
            style={{ background: theme.canvas.background, cursor: input.cursor }}
            onPointerDown={input.onPointerDown}
            onDoubleClick={input.onDoubleClick}
            onWheel={input.onWheel}
            onContextMenu={onContextMenu}
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
        >
            <CanvasGrid viewport={viewport} mode={backgroundMode} />
            <div className="absolute origin-top-left" style={{ transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.k})`, willChange: input.isPanning ? "transform" : undefined }}>
                {children}
            </div>
        </div>
    );
}

function CanvasGrid({ viewport, mode }: { viewport: ViewportTransform; mode: CanvasBackgroundMode }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const grid = useMemo(() => {
        if (mode === "blank") return null;
        const size = 48 * viewport.k * (viewport.k < 0.25 ? 4 : 1);
        const dot = viewport.k < 0.12 ? 0.8 : 1.15;
        const image = mode === "dots"
            ? `radial-gradient(circle, ${theme.canvas.dot} ${dot}px, transparent ${dot + 0.2}px)`
            : `linear-gradient(${theme.canvas.line} 1px, transparent 1px), linear-gradient(90deg, ${theme.canvas.line} 1px, transparent 1px)`;
        return { size, image, x: viewport.x % size, y: viewport.y % size };
    }, [mode, theme.canvas.dot, theme.canvas.line, viewport.k, viewport.x, viewport.y]);
    if (!grid) return null;
    return <div className="canvas-atlas-grid pointer-events-none absolute inset-0 opacity-40" style={{ backgroundImage: grid.image, backgroundSize: `${grid.size}px ${grid.size}px`, backgroundPosition: `${grid.x}px ${grid.y}px` }} />;
}
