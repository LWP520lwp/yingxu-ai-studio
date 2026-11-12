import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export type NodeContentRoute =
  | { kind: "custom-config" }
  | { kind: "batch"; nodeType: CanvasNodeType.Image | CanvasNodeType.Text }
  | { kind: "status"; status: "loading" | "error" }
  | { kind: "builtin"; nodeType: CanvasNodeType }
  | { kind: "plugin" }
  | { kind: "missing-plugin" };

export type NodeContentRouteInput = {
  node: CanvasNodeData;
  isBatchRoot: boolean;
  hasCustomConfigContent: boolean;
  hasPluginRenderer: boolean;
};

const builtinNodeTypes = new Set<string>(Object.values(CanvasNodeType));

export function resolveNodeContentRoute({
  node,
  isBatchRoot,
  hasCustomConfigContent,
  hasPluginRenderer,
}: NodeContentRouteInput): NodeContentRoute {
  if (node.type === CanvasNodeType.Config && hasCustomConfigContent) {
    return { kind: "custom-config" };
  }

  if (node.type === CanvasNodeType.Image && isBatchRoot) {
    return { kind: "batch", nodeType: CanvasNodeType.Image };
  }

  const texts = node.metadata?.texts;
  if (
    node.type === CanvasNodeType.Text &&
    texts?.length &&
    (node.metadata?.status !== "error" || texts.some((text) => text.content))
  ) {
    return { kind: "batch", nodeType: CanvasNodeType.Text };
  }

  if (node.metadata?.status === "loading") {
    return { kind: "status", status: "loading" };
  }
  if (node.metadata?.status === "error") {
    return { kind: "status", status: "error" };
  }

  if (builtinNodeTypes.has(node.type)) {
    return { kind: "builtin", nodeType: node.type as CanvasNodeType };
  }
  return hasPluginRenderer ? { kind: "plugin" } : { kind: "missing-plugin" };
}
