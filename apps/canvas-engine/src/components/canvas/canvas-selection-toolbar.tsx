import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Film, Group, Ungroup } from "lucide-react";
import { Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { nodeBounds } from "@/lib/canvas/canvas-node-geometry";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";

const SELECTION_PAD = 14;

export function CanvasSelectionToolbar({
    nodes,
    viewport,
    canvasSize,
    showToolbar,
    canGroup,
    canUngroup,
    canMerge = false,
    onMerge,
    onGroup,
    onUngroup,
}: {
    nodes: CanvasNodeData[];
    viewport: ViewportTransform;
    canvasSize: { width: number; height: number };
    showToolbar: boolean;
    canGroup: boolean;
    canUngroup: boolean;
    canMerge?: boolean;
    onMerge?: () => void;
    onGroup: () => void;
    onUngroup: () => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const toolbarRef = useRef<HTMLDivElement>(null);
    const [toolbarSize, setToolbarSize] = useState({ width: 360, height: 48 });
    const actionCount = Number(canGroup) + Number(canUngroup) + Number(canMerge);
    useLayoutEffect(() => {
        const element = toolbarRef.current;
        if (!element) return;
        const measure = () => {
            const rect = element.getBoundingClientRect();
            setToolbarSize((previous) => previous.width === rect.width && previous.height === rect.height ? previous : { width: rect.width, height: rect.height });
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [showToolbar, actionCount, nodes.length]);
    if (nodes.length < 2) return null;

    const bounds = nodeBounds(nodes);
    const left = viewport.x + bounds.left * viewport.k - SELECTION_PAD;
    const top = viewport.y + bounds.top * viewport.k - SELECTION_PAD;
    const width = (bounds.right - bounds.left) * viewport.k + SELECTION_PAD * 2;
    const height = (bounds.bottom - bounds.top) * viewport.k + SELECTION_PAD * 2;
    const showActions = showToolbar && (canGroup || canUngroup || canMerge);
    // The selection outline remains in world space; only its action bar follows the visible canvas.
    // canvasSize is measured inside the section, so the separate left asset panel is already excluded.
    const toolbarWidth = Math.min(toolbarSize.width, Math.max(0, canvasSize.width - 24));
    const minimumTop = Math.min(76, Math.max(12, canvasSize.height - toolbarSize.height - 12));
    const maximumTop = Math.max(minimumTop, canvasSize.height - toolbarSize.height - (canvasSize.height > 200 ? 96 : 12));
    const toolbarLeft = Math.max(12, Math.min(left + width / 2 - toolbarWidth / 2, canvasSize.width - toolbarWidth - 12));
    const toolbarTop = Math.max(minimumTop, Math.min(top - 8 - toolbarSize.height, maximumTop));

    return (
        <>
            <svg className="pointer-events-none absolute z-[65] overflow-visible" style={{ left, top, width, height }}>
                <rect
                    x={1}
                    y={1}
                    width={Math.max(width - 2, 0)}
                    height={Math.max(height - 2, 0)}
                    rx={16}
                    ry={16}
                    fill={theme.canvas.selectionFill}
                    stroke={theme.canvas.selectionStroke}
                    strokeOpacity={0.55}
                    strokeWidth={1.5}
                    strokeDasharray="7 5"
                    strokeLinecap="round"
                />
            </svg>
            {showActions ? (
                <div
                    ref={toolbarRef}
                    className="absolute z-[70] flex h-12 items-center overflow-x-auto rounded-[18px] border border-black/10 bg-white text-[15px] text-[#242529] shadow-[0_8px_28px_rgba(15,23,42,.12)]"
                    style={{ left: toolbarLeft, top: toolbarTop, maxWidth: Math.max(0, canvasSize.width - 24) }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    {canMerge && onMerge ? <SelectionAction title="按选择的视频创建合成预览，可调整顺序、选段和音量" label="合成预览" icon={<Film className="size-4" />} onClick={onMerge} /> : null}
                    {canGroup ? <SelectionAction title={t("canvas.nodeToolbar.groupTitle")} label={t("canvas.nodeToolbar.group")} icon={<Group className="size-4" />} onClick={onGroup} /> : null}
                    {canUngroup ? <SelectionAction title={t("canvas.nodeToolbar.ungroupTitle")} label={t("canvas.nodeToolbar.ungroup")} icon={<Ungroup className="size-4" />} onClick={onUngroup} /> : null}
                </div>
            ) : null}
        </>
    );
}

function SelectionAction({ title, label, icon, onClick }: { title: string; label: string; icon: ReactNode; onClick: () => void }) {
    return (
        <Tooltip title={title} placement="top" mouseEnterDelay={0.2} color="#ffffff" styles={{ root: { color: "#242529", boxShadow: "0 8px 24px rgba(15,23,42,.16)", fontSize: 13, fontWeight: 500 } }}>
            <button type="button" className="group relative flex h-12 items-center whitespace-nowrap px-1.5" onClick={onClick} aria-label={title}>
                <span className="flex h-9 items-center gap-2 rounded-lg px-2.5 transition group-hover:bg-[#f0f0f1]">
                    {icon}
                    <span>{label}</span>
                </span>
            </button>
        </Tooltip>
    );
}
