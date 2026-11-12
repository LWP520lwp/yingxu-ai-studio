import { memo, useId, useMemo, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";

import { activeConnectionCurve, connectionCurve } from "@/lib/canvas/canvas-geometry";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasConnection, CanvasNodeData, ConnectionHandle, Position } from "@/types/canvas";

type ConnectionPathProps = {
    connection: CanvasConnection;
    from: CanvasNodeData;
    to: CanvasNodeData;
    active: boolean;
    onSelect: () => void;
    onContextMenu?: (event: ReactMouseEvent<SVGPathElement>) => void;
};

/** SVG presentation layer for a persisted canvas connection. */
export const ConnectionPath = memo(function ConnectionPath({ connection, from, to, active, onSelect, onContextMenu }: ConnectionPathProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const markerId = `canvas-connection-arrow-${useId().replace(/:/g, "")}`;
    const curve = useMemo(() => connectionCurve(from, to), [from, to]);
    const stroke = active ? theme.node.activeStroke : theme.node.muted;
    const glow = active ? `drop-shadow(0 0 8px ${theme.node.activeStroke}66)` : undefined;
    const selectPath = (event: ReactMouseEvent<SVGPathElement>) => {
        event.stopPropagation();
        onSelect();
    };
    const openMenu = (event: ReactMouseEvent<SVGPathElement>) => {
        event.preventDefault();
        event.stopPropagation();
        onContextMenu?.(event);
    };
    const selectWithKeyboard = (event: ReactKeyboardEvent<SVGPathElement>) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        onSelect();
    };

    return (
        <g data-connection-group={connection.id} role="presentation">
            <defs>
                <marker id={markerId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" markerUnits="strokeWidth" orient="auto">
                    <path d="M 0 0 L 8 4 L 0 8 z" fill={stroke} />
                </marker>
            </defs>
            <path
                data-connection-id={connection.id}
                d={curve.path}
                fill="none"
                stroke="transparent"
                strokeWidth={18}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                pointerEvents="stroke"
                role="button"
                tabIndex={0}
                aria-label={`连接 ${from.title || from.id} 到 ${to.title || to.id}`}
                style={{ cursor: "pointer" }}
                onClick={selectPath}
                onKeyDown={selectWithKeyboard}
                onContextMenu={openMenu}
            />
            {active ? <path d={curve.path} stroke={stroke} strokeWidth={11} strokeOpacity={0.14} strokeLinecap="round" fill="none" pointerEvents="none" vectorEffect="non-scaling-stroke" /> : null}
            <path
                d={curve.path}
                stroke={stroke}
                strokeWidth={active ? 3.5 : 2.5}
                strokeOpacity={active ? 1 : 0.92}
                strokeLinecap="round"
                strokeLinejoin="round"
                markerEnd={`url(#${markerId})`}
                fill="none"
                pointerEvents="none"
                vectorEffect="non-scaling-stroke"
                style={{ filter: glow }}
            />
        </g>
    );
});

type ActiveConnectionPathProps = { node?: CanvasNodeData; handle: ConnectionHandle; mouseWorld: Position; target?: CanvasNodeData };

export const ActiveConnectionPath = memo(function ActiveConnectionPath({ node, handle, mouseWorld, target }: ActiveConnectionPathProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const curve = useMemo(() => (node ? activeConnectionCurve(node, handle.handleType, mouseWorld, target) : null), [handle.handleType, mouseWorld, node, target]);
    if (!curve) return null;

    return <path data-connection-preview d={curve.path} stroke={theme.node.activeStroke} strokeWidth={2} strokeLinecap="round" fill="none" strokeDasharray="6 6" vectorEffect="non-scaling-stroke" pointerEvents="none" />;
});
