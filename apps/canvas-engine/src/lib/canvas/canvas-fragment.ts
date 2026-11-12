import { nanoid } from "nanoid";

import { nodeBounds } from "@/lib/canvas/canvas-node-geometry";
import {
  CanvasNodeType,
  type CanvasConnection,
  type CanvasNodeData,
  type Position,
} from "@/types/canvas";

/** An isolated graph snapshot; it never retains mutable editor metadata. */
export type CanvasFragment = {
  nodes: CanvasNodeData[];
  connections: CanvasConnection[];
};

type Placement =
  { center: Position; offset?: never } | { offset: Position; center?: never };
type FragmentOptions = Placement & {
  existingNodes: readonly CanvasNodeData[];
  preserveExternalGroups?: boolean;
  idFactory?: () => string;
  copySuffix?: string;
};

/** Copying a group captures all descendants, including nested groups. */
export function captureCanvasFragment(
  nodes: readonly CanvasNodeData[],
  connections: readonly CanvasConnection[],
  selected: ReadonlySet<string>,
): CanvasFragment | null {
  if (!selected.size) return null;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    const parent = node.metadata?.groupId;
    if (!parent) continue;
    const members = children.get(parent) || [];
    members.push(node.id);
    children.set(parent, members);
  }
  const included = new Set<string>();
  const pending = [...selected];
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const id = pending[cursor];
    if (included.has(id)) continue;
    const node = byId.get(id);
    if (!node) continue;
    included.add(id);
    if (node.type === CanvasNodeType.Group)
      pending.push(...(children.get(id) || []));
  }
  if (!included.size) return null;
  return structuredClone({
    nodes: nodes.filter((node) => included.has(node.id)),
    // Incoming references remain useful when their source stays on the board.
    connections: connections.filter(
      (edge) => included.has(edge.toNodeId) && byId.has(edge.fromNodeId),
    ),
  });
}

function copyMetadata(
  node: CanvasNodeData,
  ids: ReadonlyMap<string, string>,
  existing: ReadonlyMap<string, CanvasNodeData>,
  preserveGroups: boolean,
) {
  if (!node.metadata) return undefined;
  const metadata = structuredClone(node.metadata);
  if (metadata.groupId) {
    const external = existing.get(metadata.groupId);
    metadata.groupId =
      ids.get(metadata.groupId) ??
      (preserveGroups && external?.type === CanvasNodeType.Group
        ? external.id
        : undefined);
  }
  // A new node must not take ownership of another node's active remote task.
  if (metadata.status === "loading")
    metadata.status = metadata.content ? "success" : "idle";
  delete metadata.videoTaskId;
  delete metadata.videoTaskProjectId;
  delete metadata.videoTaskProvider;
  for (const image of metadata.images || []) {
    if (image.status === "loading")
      image.status = image.content ? "success" : "idle";
  }
  for (const text of metadata.texts || []) {
    if (text.status === "loading")
      text.status = text.content ? "success" : "idle";
  }
  if (metadata.composition) {
    metadata.composition.clips = metadata.composition.clips.map((clip) => ({
      ...clip,
      sourceNodeId: ids.get(clip.sourceNodeId) ?? clip.sourceNodeId,
    }));
  }
  return metadata;
}

/** Materialize a snapshot at an offset or around a requested world center. */
export function placeCanvasFragment(
  fragment: CanvasFragment,
  options: FragmentOptions,
): CanvasFragment {
  if (!fragment.nodes.length) return { nodes: [], connections: [] };
  const makeId = options.idFactory || nanoid;
  const existing = new Map(
    options.existingNodes.map((node) => [node.id, node]),
  );
  const ids = new Map(fragment.nodes.map((node) => [node.id, makeId()]));
  const bounds = nodeBounds(fragment.nodes);
  const delta = options.offset || {
    x: options.center.x - (bounds.left + bounds.right) / 2,
    y: options.center.y - (bounds.top + bounds.bottom) / 2,
  };
  const suffix = options.copySuffix ?? " Copy";
  const nodes = fragment.nodes.map((source): CanvasNodeData => ({
    ...source,
    id: ids.get(source.id)!,
    title:
      suffix && !source.title.endsWith(suffix)
        ? source.title + suffix
        : source.title,
    position: {
      x: source.position.x + delta.x,
      y: source.position.y + delta.y,
    },
    metadata: copyMetadata(
      source,
      ids,
      existing,
      options.preserveExternalGroups === true,
    ),
  }));
  const seen = new Map<string, Set<string>>();
  const connections: CanvasConnection[] = [];
  for (const edge of fragment.connections) {
    const target = ids.get(edge.toNodeId);
    const source =
      ids.get(edge.fromNodeId) ??
      (existing.has(edge.fromNodeId) ? edge.fromNodeId : undefined);
    if (!source || !target || source === target) continue;
    const targets = seen.get(source) || new Set<string>();
    if (targets.has(target)) continue;
    targets.add(target);
    seen.set(source, targets);
    connections.push({
      ...edge,
      id: makeId(),
      fromNodeId: source,
      toNodeId: target,
    });
  }
  return { nodes, connections };
}
