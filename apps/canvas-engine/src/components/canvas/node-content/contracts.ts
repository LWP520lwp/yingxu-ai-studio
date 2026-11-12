import type { ReactNode } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { CanvasNodeData, CanvasNodeType } from "@/types/canvas";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

export type NodeContentRendererProps = {
  node: CanvasNodeData;
  theme: (typeof canvasThemes)[keyof typeof canvasThemes];
  isEditingContent: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  isBatchRoot: boolean;
  batchCount: number;
  batchExpanded: boolean;
  scale: number;
  renderNodeContent?: (node: CanvasNodeData) => ReactNode;
  pluginContext?: CanvasNodeContext | null;
  onContentChange: (nodeId: string, content: string) => void;
  onStopEditing: () => void;
  mentionReferences: CanvasResourceReference[];
  onRetry?: (node: CanvasNodeData) => void;
  onToggleBatch?: () => void;
  onSetBatchPrimary?: (itemId: string) => void;
  onDuplicateBatchImage?: (imageId: string) => void;
  onDownloadBatchImage?: (imageId: string) => void;
  onRetryBatchImage?: (imageId: string) => void;
  onDeleteBatchImage?: (imageId: string) => void;
  onViewBatchImage?: (imageId: string) => void;
  groupChildCount: number;
};

export type BuiltinNodeRenderer = (
  props: NodeContentRendererProps,
) => ReactNode;
export type BuiltinNodeRendererMap = Record<
  CanvasNodeType,
  BuiltinNodeRenderer
>;
