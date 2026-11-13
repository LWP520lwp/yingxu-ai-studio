import { getAtlasNodeOwner } from "@/atlas-engine/model/node-registry";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasNodeData } from "@/types/canvas";
import type {
  CanvasNodeContext,
  CanvasPluginHost,
} from "@/types/canvas-plugin";
import {
  createAtlasPluginStorage,
  emitAtlasPluginEvent,
  onAtlasPluginEvent,
} from "./events";

export function createAtlasNodeContext(
  host: CanvasPluginHost,
  node: CanvasNodeData,
  theme: CanvasTheme,
  scale: number,
  isSelected = false,
): CanvasNodeContext {
  const binding = { id: node.id, type: node.type };
  const isBindingCurrent = () =>
    host.getNode(binding.id)?.type === binding.type;
  const runForBinding =
    <Args extends unknown[]>(action: (nodeId: string, ...args: Args) => void) =>
    (...args: Args) => {
      if (isBindingCurrent()) action(binding.id, ...args);
    };

  return {
    node,
    theme,
    scale,
    isSelected,
    updateMetadata: runForBinding((id, patch) =>
      host.updateMetadata(id, patch),
    ),
    updateNode: runForBinding((id, patch) => host.updateNode(id, patch)),
    getNode: (id) => host.getNode(id),
    getNodes: () => host.getNodes(),
    getConnections: () => host.getConnections(),
    getUpstream: () => (isBindingCurrent() ? host.getUpstream(binding.id) : []),
    getDownstream: () =>
      isBindingCurrent() ? host.getDownstream(binding.id) : [],
    applyOps: (operations) => host.applyOps(operations),
    emit: emitAtlasPluginEvent,
    on: onAtlasPluginEvent,
    ai: host.ai,
    openPanel: runForBinding((id) => host.openPanel(id)),
    closePanel: runForBinding((id) => host.closePanel(id)),
    storage: createAtlasPluginStorage(getAtlasNodeOwner(node.type)),
  };
}
