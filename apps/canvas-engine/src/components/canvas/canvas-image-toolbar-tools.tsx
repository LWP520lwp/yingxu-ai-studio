import type { ReactNode } from "react";
import {
  Brush,
  Camera,
  Copy,
  FileText,
  Grid2x2,
  Lock,
  LockOpen,
  Maximize2,
  Scissors,
  Sparkles,
  Upload,
  ZoomIn,
  type LucideIcon,
} from "lucide-react";

import i18n from "@/i18n";
import type {
  ImageNodeActionToolId,
  ImageQuickToolId,
} from "@/atlas-engine/ui/image-quick-tools";
import type { CanvasNodeData } from "@/types/canvas";

export {
  IMAGE_QUICK_TOOLS_STORAGE_KEY,
  defaultImageQuickToolIds,
  normalizeImageQuickToolIds,
  readImageQuickToolsConfig,
  setImageQuickToolVisibility,
  type ImageNodeActionToolId,
  type ImageQuickToolId,
  type ImageQuickToolsConfig,
} from "@/atlas-engine/ui/image-quick-tools";

export type ImageToolHandlers = {
  onUpload: (node: CanvasNodeData) => void;
  onToggleFreeResize: (node: CanvasNodeData) => void;
  onMaskEdit: (node: CanvasNodeData) => void;
  onCrop: (node: CanvasNodeData) => void;
  onSplit: (node: CanvasNodeData) => void;
  onUpscale: (node: CanvasNodeData) => void;
  onSuperResolve: (node: CanvasNodeData) => void;
  onAngle: (node: CanvasNodeData) => void;
  onViewImage: (node: CanvasNodeData) => void;
  onCopyPrompt: (node: CanvasNodeData) => void;
  onReversePrompt: (node: CanvasNodeData) => void;
};

export type ImageToolDefinition = {
  id: ImageNodeActionToolId;
  defaultVisible: boolean;
  labelKey: string;
  titleKey: string;
  icon: ReactNode;
  handler: keyof ImageToolHandlers;
  active?: (node: CanvasNodeData) => boolean;
  labelKeyForNode?: (node: CanvasNodeData) => string;
  titleKeyForNode?: (node: CanvasNodeData) => string;
  iconForNode?: (node: CanvasNodeData) => ReactNode;
};

export type ImageToolbarAction = {
  id: ImageNodeActionToolId;
  label: string;
  title: string;
  icon: ReactNode;
  active?: boolean;
  onClick: () => void;
};

type ToolBlueprint = Omit<ImageToolDefinition, "icon"> & {
  glyph: LucideIcon;
};

function makeIcon(glyph: LucideIcon): ReactNode {
  const Icon = glyph;
  return <Icon className="size-4" aria-hidden="true" focusable="false" />;
}

function makeTool({ glyph, ...definition }: ToolBlueprint): ImageToolDefinition {
  return { ...definition, icon: makeIcon(glyph) };
}

const promptActions: ImageToolDefinition[] = [
  makeTool({
    id: "copyPrompt",
    defaultVisible: true,
    labelKey: "canvas.imageTools.copyPrompt",
    titleKey: "canvas.imageTools.copyPromptTitle",
    glyph: Copy,
    handler: "onCopyPrompt",
  }),
  makeTool({
    id: "reversePrompt",
    defaultVisible: true,
    labelKey: "canvas.imageTools.reversePrompt",
    titleKey: "canvas.imageTools.reversePromptTitle",
    glyph: FileText,
    handler: "onReversePrompt",
  }),
];

const sourceActions: ImageToolDefinition[] = [
  makeTool({
    id: "replace",
    defaultVisible: true,
    labelKey: "canvas.imageTools.replace",
    titleKey: "canvas.imageTools.replace",
    glyph: Upload,
    handler: "onUpload",
  }),
];

const resizeAction = makeTool({
  id: "resize",
  defaultVisible: false,
  labelKey: "canvas.imageTools.locked",
  titleKey: "canvas.imageTools.freeTitle",
  glyph: Lock,
  handler: "onToggleFreeResize",
  labelKeyForNode: (node) =>
    node.metadata?.freeResize
      ? "canvas.imageTools.free"
      : "canvas.imageTools.locked",
  titleKeyForNode: (node) =>
    node.metadata?.freeResize
      ? "canvas.imageTools.lockTitle"
      : "canvas.imageTools.freeTitle",
  iconForNode: (node) => makeIcon(node.metadata?.freeResize ? LockOpen : Lock),
  active: (node) => Boolean(node.metadata?.freeResize),
});

const editingActions: ImageToolDefinition[] = [
  resizeAction,
  makeTool({
    id: "maskEdit",
    defaultVisible: true,
    labelKey: "canvas.imageTools.mask",
    titleKey: "canvas.imageTools.maskTitle",
    glyph: Brush,
    handler: "onMaskEdit",
  }),
  makeTool({
    id: "crop",
    defaultVisible: true,
    labelKey: "canvas.imageTools.crop",
    titleKey: "canvas.imageTools.cropTitle",
    glyph: Scissors,
    handler: "onCrop",
  }),
  makeTool({
    id: "split",
    defaultVisible: true,
    labelKey: "canvas.imageTools.split",
    titleKey: "canvas.imageTools.splitTitle",
    glyph: Grid2x2,
    handler: "onSplit",
  }),
  makeTool({
    id: "upscale",
    defaultVisible: true,
    labelKey: "canvas.imageTools.upscale",
    titleKey: "canvas.imageTools.upscaleTitle",
    glyph: ZoomIn,
    handler: "onUpscale",
  }),
  makeTool({
    id: "superResolve",
    defaultVisible: false,
    labelKey: "canvas.imageTools.superResolve",
    titleKey: "canvas.imageTools.superResolveTitle",
    glyph: Sparkles,
    handler: "onSuperResolve",
  }),
];

const framingActions: ImageToolDefinition[] = [
  makeTool({
    id: "angle",
    defaultVisible: false,
    labelKey: "canvas.imageTools.angle",
    titleKey: "canvas.imageTools.angleTitle",
    glyph: Camera,
    handler: "onAngle",
  }),
  makeTool({
    id: "view",
    defaultVisible: true,
    labelKey: "canvas.imageTools.view",
    titleKey: "canvas.imageTools.viewTitle",
    glyph: Maximize2,
    handler: "onViewImage",
  }),
];

export const imageToolDefinitions: ImageToolDefinition[] = [
  ...promptActions,
  ...sourceActions,
  ...editingActions,
  ...framingActions,
];

export function buildImageToolbarTools(
  node: CanvasNodeData,
  handlers: ImageToolHandlers,
): ImageToolbarAction[] {
  return imageToolDefinitions.map((definition) => {
    const labelKey = definition.labelKeyForNode?.(node) ?? definition.labelKey;
    const titleKey = definition.titleKeyForNode?.(node) ?? definition.titleKey;
    const actionHandler = handlers[definition.handler];

    return {
      id: definition.id,
      label: i18n.t(labelKey),
      title: i18n.t(titleKey),
      icon: definition.iconForNode?.(node) ?? definition.icon,
      active: definition.active?.(node),
      onClick: () => actionHandler(node),
    };
  });
}
