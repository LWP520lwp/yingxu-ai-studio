import { FileText, Image as ImageIcon, Music2, Plus, Puzzle, Video, X } from "lucide-react";
import { Popover } from "antd";
import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { getGroupResourceNodes } from "@/lib/canvas/canvas-resource-references";
import { getImagePreviewRevision, previewUrlFor, subscribeImagePreviews } from "@/services/image-storage";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { buildNodeGenerationContext, frameReferenceIssue } from "./canvas-node-generation";

export function CanvasNodeReferenceBar({ nodeId, nodes, connectedNodes, onDisconnect, onStartSelection, frameMode, framesReversed, onSwapFrames, prompt }: { nodeId: string; nodes: CanvasNodeData[]; connectedNodes: CanvasNodeData[]; onDisconnect?: (fromNodeId: string, toNodeId: string) => void; onStartSelection?: (nodeId: string) => void; frameMode?: boolean; framesReversed?: boolean; onSwapFrames?: () => void; prompt?: string }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const references = connectedNodes.flatMap((sourceNode) => (sourceNode.type === CanvasNodeType.Group ? getGroupResourceNodes(sourceNode.id, nodes) : [sourceNode]).map((node) => ({ node, sourceNodeId: sourceNode.id })));
    const visibleReferences = frameMode ? [...new Map(references.map((reference) => [reference.node.id, reference])).values()] : references;
    const target = nodes.find((node) => node.id === nodeId);
    const generationImages = frameMode ? buildNodeGenerationContext(nodeId, nodes, connectedNodes.map((node) => ({ id: node.id, fromNodeId: node.id, toNodeId: nodeId })), prompt ?? target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "", { frameMode: true }).referenceImages : [];
    const orderedImages = framesReversed ? [...generationImages].reverse() : generationImages;
    const frameIndex = new Map(orderedImages.map((image, index) => [image.id, index]));
    const frameIssue = frameReferenceIssue(orderedImages.length);
    return (
        <div className="mb-2">
            <div className="mb-1.5 text-[11px] font-medium" style={{ color: theme.node.muted }}>{t("canvas.references.title")}</div>
            <div className="thin-scrollbar flex min-h-12 gap-2 overflow-x-auto pb-1">
                {visibleReferences.map(({ node, sourceNodeId }) => <ReferenceItem key={`${sourceNodeId}:${node.id}`} node={node} label={frameMode && frameIndex.has(node.id) ? frameIndex.get(node.id) === 0 ? "首帧" : frameIndex.get(node.id) === 1 ? "尾帧" : "超出帧数" : undefined} onRemove={() => {
                    const sources = frameMode ? [...new Set(references.filter((reference) => reference.node.id === node.id).map((reference) => reference.sourceNodeId))] : [sourceNodeId];
                    sources.forEach((source) => onDisconnect?.(source, nodeId));
                }} />)}
                <button type="button" className="grid size-12 shrink-0 place-items-center rounded-xl border bg-transparent transition hover:opacity-70" style={{ borderColor: theme.toolbar.border, color: theme.node.muted }} aria-label={t("canvas.references.select")} title={t("canvas.references.select")} onClick={() => onStartSelection?.(nodeId)}>
                    <Plus className="size-4" />
                </button>
            </div>
            {frameMode && <div className="flex items-center justify-between gap-2 text-xs" style={{ color: theme.node.muted }}><span role={orderedImages.length > 2 ? "alert" : "status"}>{frameIssue || (orderedImages.length === 1 ? "当前仅使用首帧，也可再连接一张尾帧。" : "按标记使用首帧与尾帧；可通过图片引用调整顺序。")}</span>{orderedImages.length === 2 && onSwapFrames && <button type="button" className="shrink-0 rounded border px-2 py-1" onClick={onSwapFrames}>交换首尾帧</button>}</div>}
        </div>
    );
}

function ReferenceItem({ node, onRemove, label }: { node: CanvasNodeData; onRemove: () => void; label?: string }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    const content = node.metadata?.content || resource?.url;
    const thumbnail = previewUrlFor(node.metadata?.storageKey) || content;
    const Icon = resource?.kind === "image" || node.type === CanvasNodeType.Image ? ImageIcon : resource?.kind === "video" || node.type === CanvasNodeType.Video ? Video : resource?.kind === "audio" || node.type === CanvasNodeType.Audio ? Music2 : resource?.kind === "text" || node.type === CanvasNodeType.Text ? FileText : Puzzle;
    return (
        <Popover placement="topLeft" mouseEnterDelay={0.15} content={<ReferencePreview node={node} content={content} />}>
            <div className="group relative grid size-12 shrink-0 place-items-center rounded-xl border" style={{ background: theme.toolbar.activeBg, borderColor: theme.toolbar.border }}>
                <span className="grid size-full place-items-center overflow-hidden rounded-[inherit]">
                    {(resource?.kind === "image" || node.type === CanvasNodeType.Image) && thumbnail ? <img src={thumbnail} alt="" className="size-full object-cover" /> : (resource?.kind === "video" || node.type === CanvasNodeType.Video) && content ? <video src={content} className="size-full object-cover" muted /> : <Icon className="size-4 opacity-65" />}
                </span>
                {label && <span className="absolute bottom-0 left-0 right-0 rounded-b-xl bg-black/75 text-center text-[10px] text-white">{label}</span>}
                <button type="button" className="absolute right-0 top-0 grid size-5 place-items-center rounded-full border opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }} aria-label={t("canvas.references.disconnect")} title={t("canvas.references.disconnect")} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onRemove(); }}><X className="size-3" /></button>
            </div>
        </Popover>
    );
}

function ReferencePreview({ node, content }: { node: CanvasNodeData; content?: string }) {
    const { t } = useTranslation();
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    if ((resource?.kind === "image" || node.type === CanvasNodeType.Image) && content) return <img src={content} alt={node.title} className="max-h-52 w-72 rounded-lg object-contain" />;
    if ((resource?.kind === "video" || node.type === CanvasNodeType.Video) && content) return <video src={content} className="max-h-52 w-72 rounded-lg" muted controls />;
    if ((resource?.kind === "audio" || node.type === CanvasNodeType.Audio) && content) return <audio src={content} className="w-72" controls />;
    return <div className="max-h-52 w-72 overflow-auto whitespace-pre-wrap text-sm">{resource?.text || node.metadata?.content || node.metadata?.prompt || node.title || t("canvas.references.empty")}</div>;
}
