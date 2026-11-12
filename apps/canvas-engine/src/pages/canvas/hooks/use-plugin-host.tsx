import { useCallback, useEffect, useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { createCanvasPluginAiAdapter } from "@/lib/canvas/plugin-ai-adapter";
import { buildNodeContext } from "@/lib/canvas/plugin-node-context";
import { createCanvasPluginHostAdapter } from "@/lib/canvas/canvas-plugin-host";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { ensurePluginsLoaded } from "@/lib/canvas/plugin-loader";
import { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasNodeToolbarItem, CanvasPluginHost } from "@/types/canvas-plugin";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";
import type { AiConfig } from "@/stores/use-config-store";

type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];
type PluginHostParams = {
  effectiveConfig: AiConfig;
  isAiConfigReady: (config: AiConfig, model: string) => boolean;
  openConfigDialog: (open: boolean) => void;
  theme: CanvasTheme;
  nodesRef: MutableRefObject<CanvasNodeData[]>;
  connectionsRef: MutableRefObject<CanvasConnection[]>;
  viewportRef: MutableRefObject<ViewportTransform>;
  setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
  setDialogNodeId: Dispatch<SetStateAction<string | null>>;
  applyAgentOps: (ops?: CanvasAgentOp[]) => unknown;
};

export function usePluginHost(params: PluginHostParams) {
  const { t } = useTranslation();
  const { effectiveConfig, isAiConfigReady, openConfigDialog, theme, nodesRef, connectionsRef, viewportRef, setNodes, setDialogNodeId, applyAgentOps } = params;

  const ai = useMemo(() => createCanvasPluginAiAdapter(effectiveConfig, (config) => {
    if (isAiConfigReady(config, config.model)) return;
    openConfigDialog(true);
    throw new Error(t("canvas.plugins.aiConfigRequired"));
  }), [effectiveConfig, isAiConfigReady, openConfigDialog, t]);

  const host = useMemo<CanvasPluginHost>(() => createCanvasPluginHostAdapter({
    readNodes: () => nodesRef.current,
    readConnections: () => connectionsRef.current,
    setNodes,
    setDialogNodeId,
    applyOps: applyAgentOps,
    ai,
  }), [ai, applyAgentOps, connectionsRef, nodesRef, setDialogNodeId, setNodes]);

  const renderPluginPanel = useCallback((node: CanvasNodeData) => {
    const Panel = getNodeDefinition(node.type)?.Panel;
    if (!Panel || host.getNode(node.id)?.type !== node.type) return null;
    const context = buildNodeContext(host, node, theme, viewportRef.current.k);
    return <Panel ctx={context} onClose={() => setDialogNodeId(null)} />;
  }, [host, setDialogNodeId, theme, viewportRef]);

  const buildNodeToolbarItems = useCallback((node: CanvasNodeData): CanvasNodeToolbarItem[] => {
    const definition = getNodeDefinition(node.type);
    const context = buildNodeContext(host, node, theme, viewportRef.current.k);
    const actions = definition?.toolbar?.(context) ?? [];
    if (!definition?.interactionToggle || !node.metadata?.content || definition.forceInteractive?.(node)) return actions;
    return [interactionItem(node, Boolean(node.metadata.interactive), t, host), ...actions];
  }, [host, t, theme, viewportRef]);

  useEffect(() => { void ensurePluginsLoaded(); }, []);
  return { pluginHost: host, renderPluginPanel, buildNodeToolbarItems };
}

function interactionItem(node: CanvasNodeData, interactive: boolean, t: (key: string) => string, host: CanvasPluginHost): CanvasNodeToolbarItem {
  return {
    id: "node-interaction-toggle",
    title: t(interactive ? "canvas.plugins.interactiveTitle" : "canvas.plugins.movableTitle"),
    label: t(interactive ? "canvas.plugins.move" : "canvas.plugins.interact"),
    icon: interactive ? "✋" : "🖐",
    active: interactive,
    onClick: () => host.updateMetadata(node.id, { interactive: !interactive }),
  };
}
