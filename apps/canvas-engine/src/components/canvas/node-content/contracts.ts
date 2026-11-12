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
  commands: NodeContentCommands;
  mentionReferences: CanvasResourceReference[];
  groupChildCount: number;
};

export type NodeContentCommands = {
  updateText: (content: string) => void;
  stopTextEditing: () => void;
  retryGeneration?: () => void;
  toggleTextBatch?: () => void;
  setPrimaryText?: (itemId: string) => void;
  toggleImageBatch?: () => void;
  setPrimaryImage?: (itemId: string) => void;
  duplicateImage?: (itemId: string) => void;
  downloadImage?: (itemId: string) => void;
  retryImage?: (itemId: string) => void;
  deleteImage?: (itemId: string) => void;
  viewImage?: (itemId: string) => void;
};

export type BuiltinNodeRenderer = (
  props: NodeContentRendererProps,
) => ReactNode;
export type BuiltinNodeRendererMap = Record<
  CanvasNodeType,
  BuiltinNodeRenderer
>;
