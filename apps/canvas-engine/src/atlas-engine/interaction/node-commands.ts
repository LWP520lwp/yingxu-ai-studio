import { nanoid } from "nanoid";

import {
  CanvasNodeType,
  type CanvasConnection,
  type CanvasNodeData,
  type CanvasNodeImage,
  type CanvasNodeTypeId,
  type CanvasNodeMetadata,
  type ConnectionHandle,
  type Position,
} from "@/types/canvas";
import { fitAtlasNodeSize } from "@/atlas-engine/model/node-size";
import { createAtlasNode } from "@/atlas-engine/model/node-factory";
import type { AtlasCommand } from "@/atlas-engine/reducer";
import {
  applyAtlasNodeCommand,
  captureAtlasFragment,
  placeAtlasFragment,
  type AtlasCanvasFragment,
} from "./node-layout";
import { normalizeProductConnection } from "./connections";
import type { CanvasNodeDefinition } from "@/types/canvas-plugin";

export type AtlasNodePlacement = {
  nodes: CanvasNodeData[];
  connections: CanvasConnection[];
  commands: AtlasCommand[];
};

export function atlasNodeCreationOpensPanel(
  type: CanvasNodeTypeId,
  definition?: Pick<
    CanvasNodeDefinition,
    "hidePanel" | "Panel" | "autoOpenPanel" | "useBuiltinPanel"
  >,
) {
  if (definition?.hidePanel) return false;
  if (definition?.Panel) return definition.autoOpenPanel === true;
  if (definition?.useBuiltinPanel) return true;
  return (
    type === CanvasNodeType.Image ||
    type === CanvasNodeType.Video ||
    type === CanvasNodeType.Config
  );
}

/** Commits additions and their selection in one reducer transaction. */
export function planAtlasNodeInsertion(
  nodes: readonly CanvasNodeData[],
  connections: readonly CanvasConnection[] = [],
): AtlasCommand[] {
  if (!nodes.length) return [];
  return [
    ...nodes.map((node): AtlasCommand => ({
      type: "upsert-node",
      node: {
        id: node.id,
        kind: node.type,
        title: node.title,
        frame: { ...node.position, width: node.width, height: node.height },
        data: node.metadata,
      },
    })),
    ...connections.map((connection): AtlasCommand => ({
      type: "connect",
      edge: {
        id: connection.id,
        source: connection.fromNodeId,
        target: connection.toNodeId,
      },
    })),
    { type: "select", nodeIds: nodes.map((node) => node.id) },
  ];
}

/** Creates a node and its valid graph edge as one atomic plan. */
export function planAtlasConnectedNode(
  type: CanvasNodeTypeId,
  position: Position,
  source: ConnectionHandle,
  metadata: CanvasNodeMetadata | undefined,
  existingNodes: readonly CanvasNodeData[],
  idFactory: () => string = nanoid,
): AtlasNodePlacement | null {
  const node = createAtlasNode(type, position, metadata);
  const connection = normalizeProductConnection(
    source.nodeId,
    node.id,
    [...existingNodes, node],
    source.handleType,
  );
  if (!connection) return null;
  const connections = [{ id: idFactory(), ...connection }];
  return {
    nodes: [node],
    connections,
    commands: planAtlasNodeInsertion([node], connections),
  };
}

/** Captures and places a selected graph fragment with fresh ids. */
export function planAtlasFragmentClone(
  nodes: readonly CanvasNodeData[],
  connections: readonly CanvasConnection[],
  selectedIds: ReadonlySet<string>,
  placement:
    | { center: Position; preserveExternalGroups?: boolean }
    | { offset: Position; preserveExternalGroups?: boolean },
): AtlasNodePlacement | null {
  const fragment = captureAtlasFragment(nodes, connections, selectedIds);
  if (!fragment) return null;
  const placed = placeAtlasFragment(fragment, {
    ...placement,
    existingNodes: nodes,
  });
  return {
    ...placed,
    commands: planAtlasNodeInsertion(placed.nodes, placed.connections),
  };
}

export function planAtlasFragmentInsertion(
  fragment: AtlasCanvasFragment,
  nodes: readonly CanvasNodeData[],
  center: Position,
): AtlasNodePlacement | null {
  if (!fragment.nodes.length) return null;
  const placed = placeAtlasFragment(fragment, { center, existingNodes: nodes });
  return {
    ...placed,
    commands: planAtlasNodeInsertion(placed.nodes, placed.connections),
  };
}

export function planAtlasConnectionRemoval(
  connectionId: string,
): AtlasCommand[] {
  return connectionId.trim()
    ? [{ type: "disconnect", edgeId: connectionId }]
    : [];
}

export function planAtlasReferenceDisconnect(
  connections: readonly CanvasConnection[],
  fromNodeId: string,
  toNodeId: string,
): AtlasCommand[] {
  return connections.flatMap((connection) =>
    connection.fromNodeId === fromNodeId && connection.toNodeId === toNodeId
      ? planAtlasConnectionRemoval(connection.id)
      : [],
  );
}

function duplicateImageMetadata(
  node: CanvasNodeData,
  image: CanvasNodeImage,
): CanvasNodeMetadata {
  const {
    prompt,
    generationType,
    model,
    size,
    quality,
    background,
    references,
  } = node.metadata ?? {};
  const {
    id: _id,
    status: _status,
    errorDetails: _errorDetails,
    ...media
  } = image;
  return {
    ...media,
    status: "success",
    prompt,
    generationType,
    model,
    size,
    quality,
    background,
    references: references ? [...references] : undefined,
  };
}

/** Creates a standalone image node from a batch variant. */
export function planAtlasBatchImageDuplicate(
  node: CanvasNodeData,
  imageId: string,
  idFactory: () => string = nanoid,
): CanvasNodeData | null {
  const image = node.metadata?.images?.find((item) => item.id === imageId);
  if (!image?.content) return null;
  const edge = Math.max(node.width, node.height);
  const size = fitAtlasNodeSize(
    image.naturalWidth,
    image.naturalHeight,
    edge,
    edge,
  );
  const created = createAtlasNode(
    CanvasNodeType.Image,
    {
      x: node.position.x + node.width * 2 + 96 + size.width / 2,
      y: node.position.y + node.height / 2,
    },
    duplicateImageMetadata(node, image),
    () => ({ ...size, title: node.title }),
  );
  return {
    ...created,
    id: idFactory(),
  };
}

/** Applies a batch variant selection through the shared immutable edit command. */
export function planAtlasBatchPrimary(
  nodes: CanvasNodeData[],
  nodeId: string,
  variantId: string,
) {
  return applyAtlasNodeCommand(nodes, {
    kind: "select-variant",
    nodeId,
    variantId,
  });
}

/** Removes a batch variant and reports when the expanded inspector should close. */
export function atlasBatchRemovalCollapses(node: CanvasNodeData | undefined) {
  return (node?.metadata?.images?.length ?? 0) < 3;
}

export function planAtlasBatchImageRemoval(
  nodes: CanvasNodeData[],
  nodeId: string,
  variantId: string,
) {
  const node = nodes.find((item) => item.id === nodeId);
  return {
    nodes: applyAtlasNodeCommand(nodes, {
      kind: "remove-variant",
      nodeId,
      variantId,
    }),
    shouldCollapse: atlasBatchRemovalCollapses(node),
  };
}

export type { AtlasCanvasFragment };
