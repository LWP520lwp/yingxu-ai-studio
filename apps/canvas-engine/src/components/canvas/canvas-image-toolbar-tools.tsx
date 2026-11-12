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
} from "lucide-react";

import i18n from "@/i18n";
import {
  type ImageNodeActionToolId,
  type ImageQuickToolId,
} from "@/lib/canvas/image-quick-tools";
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
} from "@/lib/canvas/image-quick-tools";

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

export const imageToolDefinitions = [
  {
    id: "copyPrompt",
    defaultVisible: true,
    labelKey: "canvas.imageTools.copyPrompt",
    titleKey: "canvas.imageTools.copyPromptTitle",
    icon: <Copy className="size-4" />,
    handler: "onCopyPrompt",
  },
  {
    id: "reversePrompt",
    defaultVisible: true,
    labelKey: "canvas.imageTools.reversePrompt",
    titleKey: "canvas.imageTools.reversePromptTitle",
    icon: <FileText className="size-4" />,
    handler: "onReversePrompt",
  },
  {
    id: "replace",
    defaultVisible: true,
    labelKey: "canvas.imageTools.replace",
    titleKey: "canvas.imageTools.replace",
    icon: <Upload className="size-4" />,
    handler: "onUpload",
  },
  {
    id: "resize",
    defaultVisible: false,
    labelKey: "canvas.imageTools.locked",
    titleKey: "canvas.imageTools.freeTitle",
    icon: <Lock className="size-4" />,
    handler: "onToggleFreeResize",
    labelKeyForNode: (node: CanvasNodeData) =>
      node.metadata?.freeResize
        ? "canvas.imageTools.free"
        : "canvas.imageTools.locked",
    titleKeyForNode: (node: CanvasNodeData) =>
      node.metadata?.freeResize
        ? "canvas.imageTools.lockTitle"
        : "canvas.imageTools.freeTitle",
    iconForNode: (node: CanvasNodeData) =>
      node.metadata?.freeResize ? (
        <LockOpen className="size-4" />
      ) : (
        <Lock className="size-4" />
      ),
    active: (node: CanvasNodeData) => Boolean(node.metadata?.freeResize),
  },
  {
    id: "maskEdit",
    defaultVisible: true,
    labelKey: "canvas.imageTools.mask",
    titleKey: "canvas.imageTools.maskTitle",
    icon: <Brush className="size-4" />,
    handler: "onMaskEdit",
  },
  {
    id: "crop",
    defaultVisible: true,
    labelKey: "canvas.imageTools.crop",
    titleKey: "canvas.imageTools.cropTitle",
    icon: <Scissors className="size-4" />,
    handler: "onCrop",
  },
  {
    id: "split",
    defaultVisible: true,
    labelKey: "canvas.imageTools.split",
    titleKey: "canvas.imageTools.splitTitle",
    icon: <Grid2x2 className="size-4" />,
    handler: "onSplit",
  },
  {
    id: "upscale",
    defaultVisible: true,
    labelKey: "canvas.imageTools.upscale",
    titleKey: "canvas.imageTools.upscaleTitle",
    icon: <ZoomIn className="size-4" />,
    handler: "onUpscale",
  },
  {
    id: "superResolve",
    defaultVisible: false,
    labelKey: "canvas.imageTools.superResolve",
    titleKey: "canvas.imageTools.superResolveTitle",
    icon: <Sparkles className="size-4" />,
    handler: "onSuperResolve",
  },
  {
    id: "angle",
    defaultVisible: false,
    labelKey: "canvas.imageTools.angle",
    titleKey: "canvas.imageTools.angleTitle",
    icon: <Camera className="size-4" />,
    handler: "onAngle",
  },
  {
    id: "view",
    defaultVisible: true,
    labelKey: "canvas.imageTools.view",
    titleKey: "canvas.imageTools.viewTitle",
    icon: <Maximize2 className="size-4" />,
    handler: "onViewImage",
  },
] satisfies readonly ImageToolDefinition[];

export function buildImageToolbarTools(
  node: CanvasNodeData,
  handlers: ImageToolHandlers,
): ImageToolbarAction[] {
  return imageToolDefinitions.map((tool) => {
    const labelKey = tool.labelKeyForNode?.(node) ?? tool.labelKey;
    const titleKey = tool.titleKeyForNode?.(node) ?? tool.titleKey;
    return {
      id: tool.id,
      label: i18n.t(labelKey),
      title: i18n.t(titleKey),
      icon: tool.iconForNode?.(node) ?? tool.icon,
      active: tool.active?.(node),
      onClick: () => handlers[tool.handler](node),
    };
  });
}
