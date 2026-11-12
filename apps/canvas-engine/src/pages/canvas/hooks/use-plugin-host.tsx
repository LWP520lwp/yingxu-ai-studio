import {
  useCallback,
  useEffect,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { useTranslation } from "react-i18next";

import { createCanvasPluginAiAdapter } from "@/lib/canvas/plugin-ai-adapter";
import { buildNodeContext } from "@/lib/canvas/plugin-node-context";
import { createCanvasPluginHostAdapter } from "@/lib/canvas/canvas-plugin-host";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { ensurePluginsLoaded } from "@/lib/canvas/plugin-loader";
import { canvasThemes } from "@/lib/canvas-theme";
import type {
  CanvasNodeToolbarItem,
  CanvasPluginHost,
} from "@/types/canvas-plugin";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type {
  CanvasConnection,
  CanvasNodeData,
  ViewportTransform,
} from "@/types/canvas";
import { type AiConfig } from "@/stores/use-config-store";

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

/**
 * Plugin node host capabilities: expose host-side AI generation, canvas access, and panel controls
 * through plugin-callable host/ai objects. Loads installed remote plugins on mount and returns renderers for plugin panels and toolbars.
 */
export function usePluginHost(params: PluginHostParams) {
  const { t } = useTranslation();
  const {
    effectiveConfig,
    isAiConfigReady,
    openConfigDialog,
    theme,
    nodesRef,
    connectionsRef,
    viewportRef,
    setNodes,
    setDialogNodeId,
    applyAgentOps,
  } = params;

  // Host capabilities available to plugin nodes; methods receive nodeId and are not bound to a specific node.
  const pluginAi = useMemo(
    () =>
      createCanvasPluginAiAdapter(effectiveConfig, (config) => {
        if (!isAiConfigReady(config, config.model)) {
          openConfigDialog(true);
          throw new Error(t("canvas.plugins.aiConfigRequired"));
        }
      }),
    [effectiveConfig, isAiConfigReady, openConfigDialog, t],
  );

  const pluginHost = useMemo<CanvasPluginHost>(
    () =>
      createCanvasPluginHostAdapter({
        readNodes: () => nodesRef.current,
        readConnections: () => connectionsRef.current,
        setNodes: (update) => setNodes(update),
        setDialogNodeId,
        applyOps: applyAgentOps,
        ai: pluginAi,
      }),
    [
      applyAgentOps,
      nodesRef,
      connectionsRef,
      pluginAi,
      setDialogNodeId,
      setNodes,
    ],
  );

  const renderPluginPanel = useCallback(
    (panelNode: CanvasNodeData) => {
      const Panel = getNodeDefinition(panelNode.type)?.Panel;
      if (!Panel) return null;
      const ctx = buildNodeContext(
        pluginHost,
        panelNode,
        theme,
        viewportRef.current.k,
      );
      return <Panel ctx={ctx} onClose={() => setDialogNodeId(null)} />;
    },
    [pluginHost, theme],
  );

  // Build the node toolbar from plugin items and a host-provided interaction/move toggle when enabled.
  const buildNodeToolbarItems = useCallback(
    (node: CanvasNodeData): CanvasNodeToolbarItem[] => {
      const definition = getNodeDefinition(node.type);
      const ctx = buildNodeContext(
        pluginHost,
        node,
        theme,
        viewportRef.current.k,
      );
      const custom = definition?.toolbar?.(ctx) || [];
      // Show the interaction/move toggle only for nodes with content that are not forced into an interactive state.
      if (
        !definition?.interactionToggle ||
        !node.metadata?.content ||
        definition.forceInteractive?.(node)
      )
        return custom;
      const interactive = Boolean(node.metadata?.interactive);
      const toggle: CanvasNodeToolbarItem = {
        id: "node-interaction-toggle",
        title: t(
          interactive
            ? "canvas.plugins.interactiveTitle"
            : "canvas.plugins.movableTitle",
        ),
        label: t(
          interactive ? "canvas.plugins.move" : "canvas.plugins.interact",
        ),
        icon: interactive ? "✋" : "🖐",
        active: interactive,
        onClick: () =>
          pluginHost.updateMetadata(node.id, { interactive: !interactive }),
      };
      return [toggle, ...custom];
    },
    [pluginHost, t, theme],
  );

  // Load installed remote plugins on startup.
  useEffect(() => {
    void ensurePluginsLoaded();
  }, []);

  return { pluginHost, renderPluginPanel, buildNodeToolbarItems };
}
