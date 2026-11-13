import type { ReactNode } from "react";
import type { CanvasAgentOp } from "@/atlas-engine/agent/canvas-operations";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import type { CanvasNodeData } from "@/types/canvas";
import type { AiConfig } from "@/stores/use-config-store";
import {
  getAtlasNodeDefinition,
  getAtlasNodeOwner,
} from "@/atlas-engine/model/node-registry";
import {
  createAtlasPluginStorage,
  emitAtlasPluginEvent,
  onAtlasPluginEvent,
} from "@/atlas-engine/plugins/events";
import { createAtlasPluginGeneration } from "@/atlas-engine/plugins/generation-adapter";
import { canvasThemes } from "@/lib/canvas-theme";
import { StudioSession, makeStudioNode, studioId } from "./studio-document";

export function applyStudioPluginOperations(
  session: StudioSession,
  operations: CanvasAgentOp[],
) {
  const generators: Extract<CanvasAgentOp, { type: "run_generation" }>[] = [];
  session.beginGesture();
  try {
    for (const op of operations.slice(0, 200)) {
      if (op.type === "add_node") {
        const node = makeStudioNode(
          op.nodeType || "text",
          op.position?.x ?? op.x ?? 0,
          op.position?.y ?? op.y ?? 0,
          op.title || "Untitled",
          op.metadata,
        );
        if (op.id && !session.read().nodes.some((item) => item.id === op.id))
          node.id = op.id;
        if (op.width) node.width = op.width;
        if (op.height) node.height = op.height;
        session.insert([node]);
      } else if (op.type === "update_node") {
        if (op.patch) session.patch(op.id, op.patch);
        if (op.metadata) session.metadata(op.id, op.metadata);
      } else if (op.type === "delete_node")
        session.remove(
          new Set(
            op.ids ||
              (op.id
                ? [op.id]
                : session
                    .read()
                    .nodes.filter((node) => node.type === op.nodeType)
                    .map((node) => node.id)),
          ),
        );
      else if (op.type === "delete_connections") {
        const ids = new Set(op.ids || (op.id ? [op.id] : []));
        session.change((doc) => ({
          ...doc,
          connections: op.all
            ? []
            : doc.connections.filter((edge) => !ids.has(edge.id)),
        }));
      } else if (op.type === "connect_nodes")
        session.connect(op.fromNodeId, op.toNodeId);
      else if (op.type === "set_viewport")
        session.change((doc) => ({ ...doc, viewport: op.viewport }), false);
      else if (op.type === "select_nodes") session.select(op.ids);
      else if (op.type === "run_generation") generators.push(op);
    }
  } finally {
    session.endGesture();
  }
  return generators;
}

export function studioPluginContext(
  session: StudioSession,
  node: CanvasNodeData,
  options: {
    config: AiConfig;
    theme: keyof typeof canvasThemes;
    open: (id: string | null) => void;
    generate: (
      id: string,
      mode: "image" | "video" | "text" | "audio",
      prompt: string,
    ) => void;
  },
): CanvasNodeContext {
  const current = () =>
    session.alive() &&
    session
      .read()
      .nodes.some((item) => item.id === node.id && item.type === node.type);
  const peers = (up: boolean) => {
    const ids = new Set(
      session
        .read()
        .connections.filter(
          (edge) => (up ? edge.toNodeId : edge.fromNodeId) === node.id,
        )
        .map((edge) => (up ? edge.fromNodeId : edge.toNodeId)),
    );
    return session.read().nodes.filter((item) => ids.has(item.id));
  };
  return {
    node,
    theme: canvasThemes[options.theme],
    scale: session.read().viewport.k,
    isSelected: session.snapshot().selection.has(node.id),
    getNode: (id) =>
      session.read().nodes.find((item) => item.id === id) || null,
    getNodes: () => session.read().nodes,
    getConnections: () => session.read().connections,
    getUpstream: () => peers(true),
    getDownstream: () => peers(false),
    updateMetadata: (patch) => {
      if (current()) session.metadata(node.id, patch);
    },
    updateNode: (patch) => {
      if (current()) session.patch(node.id, patch);
    },
    openPanel: () => {
      if (current()) options.open(node.id);
    },
    closePanel: () => options.open(null),
    emit: emitAtlasPluginEvent,
    on: onAtlasPluginEvent,
    storage: createAtlasPluginStorage(getAtlasNodeOwner(node.type)),
    ai: createAtlasPluginGeneration(options.config, () => {
      if (!current()) throw new Error("Canvas context changed");
    }),
    applyOps: (operations) => {
      if (current())
        for (const run of applyStudioPluginOperations(session, operations))
          options.generate(run.nodeId, run.mode || "image", run.prompt || "");
    },
  };
}

export function studioExtensionContent(
  node: CanvasNodeData,
  context: CanvasNodeContext,
): ReactNode {
  const Component = getAtlasNodeDefinition(node.type)?.Content;
  return Component ? <Component ctx={context} /> : null;
}

export function studioCompositionNode(
  nodes: CanvasNodeData[],
  x: number,
  y: number,
): CanvasNodeData | null {
  const videos = nodes.filter(
    (node) => node.type === "video" && node.metadata?.content,
  );
  if (videos.length < 2) return null;
  return {
    ...makeStudioNode("platform:composition", x, y, "Sequence"),
    width: 580,
    height: 460,
    metadata: {
      composition: {
        version: 1,
        clips: videos.map((node) => ({
          id: studioId(),
          sourceNodeId: node.id,
          title: node.title,
          url: node.metadata!.content!,
          storageKey: node.metadata?.storageKey,
          mimeType: node.metadata?.mimeType,
          durationMs: node.metadata?.durationMs,
          startMs: 0,
          endMs: null,
          volume: 1,
        })),
      },
    },
  };
}
