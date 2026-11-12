import { createPluginStorage, emitCanvasEvent, onCanvasEvent } from "@/lib/canvas/canvas-event-bus";
import { getNodePluginId } from "@/lib/canvas/node-registry";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasNodeData } from "@/types/canvas";
import type { CanvasNodeContext, CanvasPluginHost } from "@/types/canvas-plugin";

export function buildNodeContext(
  host: CanvasPluginHost,
  node: CanvasNodeData,
  theme: CanvasTheme,
  scale: number,
  isSelected = false,
): CanvasNodeContext {
  const nodeId = node.id;
  const nodeType = node.type;
  const isStillBound = () => host.getNode(nodeId)?.type === nodeType;
  const storage = createPluginStorage(getNodePluginId(nodeType));

  return {
    node,
    theme,
    scale,
    isSelected,
    updateMetadata: (patch) => {
      if (isStillBound()) host.updateMetadata(nodeId, patch);
    },
    updateNode: (patch) => {
      if (isStillBound()) host.updateNode(nodeId, patch);
    },
    getNode: (id) => host.getNode(id),
    getNodes: () => host.getNodes(),
    getConnections: () => host.getConnections(),
    getUpstream: () => isStillBound() ? host.getUpstream(nodeId) : [],
    getDownstream: () => isStillBound() ? host.getDownstream(nodeId) : [],
    applyOps: (ops) => host.applyOps(ops),
    emit: (event, payload) => emitCanvasEvent(event, payload),
    on: (event, handler) => onCanvasEvent(event, handler),
    ai: host.ai,
    openPanel: () => {
      if (isStillBound()) host.openPanel(nodeId);
    },
    closePanel: () => {
      if (isStillBound()) host.closePanel(nodeId);
    },
    storage,
  };
}
