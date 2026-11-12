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
  const identity = { id: node.id, type: node.type };
  const stillOwnsSlot = () => host.getNode(identity.id)?.type === identity.type;
  const withCurrentNode = <Args extends unknown[]>(action: (id: string, ...args: Args) => void) =>
    (...args: Args) => { if (stillOwnsSlot()) action(identity.id, ...args); };

  return {
    node,
    theme,
    scale,
    isSelected,
    updateMetadata: withCurrentNode((id, patch) => host.updateMetadata(id, patch)),
    updateNode: withCurrentNode((id, patch) => host.updateNode(id, patch)),
    getNode: (id) => host.getNode(id),
    getNodes: () => host.getNodes(),
    getConnections: () => host.getConnections(),
    getUpstream: () => stillOwnsSlot() ? host.getUpstream(identity.id) : [],
    getDownstream: () => stillOwnsSlot() ? host.getDownstream(identity.id) : [],
    applyOps: (operations) => host.applyOps(operations),
    emit: emitCanvasEvent,
    on: onCanvasEvent,
    ai: host.ai,
    openPanel: withCurrentNode((id) => host.openPanel(id)),
    closePanel: withCurrentNode((id) => host.closePanel(id)),
    storage: createPluginStorage(getNodePluginId(node.type)),
  };
}
