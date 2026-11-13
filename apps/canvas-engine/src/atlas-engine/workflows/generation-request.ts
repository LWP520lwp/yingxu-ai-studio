import { buildNodeGenerationContext, frameReferenceIssue, type NodeGenerationContext } from "@/atlas-engine/workflows/node-generation-context";
import type { CanvasResourceIndexApi } from "@/atlas-engine/model/resource-references";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasBuiltinPanelConfig } from "@/types/canvas-plugin";
import { CanvasNodeType, type CanvasConnection, type CanvasGenerationMode, type CanvasNodeData } from "@/types/canvas";

export type AtlasGenerationRequestInput = Readonly<{
  nodeId: string;
  mode: CanvasGenerationMode;
  prompt: string;
  sourceNode?: CanvasNodeData;
  nodes: CanvasNodeData[];
  connections: CanvasConnection[];
  config: AiConfig;
  overwriteExisting: boolean;
  resourceIndex: CanvasResourceIndexApi;
  builtinPanel?: CanvasBuiltinPanelConfig;
  formatTextEdit: (source: string, instruction: string) => string;
}>;

export type AtlasGenerationRequest =
  | Readonly<{
      kind: "plugin-image-writeback";
      nodeId: string;
      scene: string;
      panel: CanvasBuiltinPanelConfig;
      config: AiConfig;
    }>
  | Readonly<{
      kind: "node-generation";
      nodeId: string;
      mode: CanvasGenerationMode;
      sourceNode?: CanvasNodeData;
      config: AiConfig;
      context: NodeGenerationContext;
      frameIssue?: string;
      overwriteExisting: boolean;
      markSourceStatus: boolean;
      isConfigurationSource: boolean;
      editingTextNode: boolean;
    }>;

/** Resolves a canvas action into the context and policy the runner must honor. */
export function resolveAtlasGenerationRequest(
  input: AtlasGenerationRequestInput,
): AtlasGenerationRequest {
  const config = input.config;
  const panel = input.builtinPanel;

  if (
    input.sourceNode &&
    input.mode === "image" &&
    panel?.writeBackToSelf &&
    panel.mode === "image"
  ) {
    return {
      kind: "plugin-image-writeback",
      nodeId: input.nodeId,
      scene: input.prompt.trim(),
      panel,
      config,
    };
  }

  const sourceText =
    input.sourceNode?.type === CanvasNodeType.Text
      ? input.sourceNode.metadata?.content?.trim() || ""
      : "";
  const editingTextNode = input.mode === "text" && Boolean(sourceText);
  const frameMode = input.mode === "video" && config.videoMode === "frames";
  const context = buildNodeGenerationContext(
    input.nodeId,
    input.nodes,
    input.connections,
    editingTextNode
      ? input.formatTextEdit(sourceText, input.prompt)
      : input.prompt,
    { frameMode, resourceIndex: input.resourceIndex },
  );

  return {
    kind: "node-generation",
    nodeId: input.nodeId,
    mode: input.mode,
    sourceNode: input.sourceNode,
    config,
    context,
    ...(frameMode ? { frameIssue: frameReferenceIssue(context.referenceImages.length) } : {}),
    overwriteExisting: input.overwriteExisting,
    markSourceStatus:
      input.sourceNode?.type !== CanvasNodeType.Image && !editingTextNode,
    isConfigurationSource: input.sourceNode?.type === CanvasNodeType.Config,
    editingTextNode,
  };
}
