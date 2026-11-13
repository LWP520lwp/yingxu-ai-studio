import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export type CanvasNodePanelRow = {
  node: CanvasNodeData;
  depth: 0 | 1;
  hasChildren: boolean;
};

export type CanvasNodePanelModel = {
  filteredNodes: CanvasNodeData[];
  rows: CanvasNodePanelRow[];
};

export function deriveCanvasNodePanelModel(
  nodes: CanvasNodeData[],
  options: {
    query: string;
    typeFilter: string;
    collapsedGroupIds: ReadonlySet<string>;
  },
): CanvasNodePanelModel {
  const query = options.query.trim().toLocaleLowerCase();
  const matches = (node: CanvasNodeData) => {
    if (options.typeFilter !== "all" && node.type !== options.typeFilter)
      return false;
    if (!query) return true;

    const metadata = node.metadata;
    const searchableText = [
      node.title,
      metadata?.prompt,
      node.type === CanvasNodeType.Text ? metadata?.content : undefined,
    ]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toLocaleLowerCase();
    return searchableText.includes(query);
  };

  const filteredNodes: CanvasNodeData[] = [];
  const matchingIds = new Set<string>();
  const groups = new Set<string>();
  const childrenByGroup = new Map<string, CanvasNodeData[]>();

  for (const node of nodes) {
    if (node.type === CanvasNodeType.Group) groups.add(node.id);
    if (matches(node)) {
      filteredNodes.push(node);
      matchingIds.add(node.id);
    }
  }

  for (const node of filteredNodes) {
    const groupId = node.metadata?.groupId;
    if (!groupId || !groups.has(groupId)) continue;
    const children = childrenByGroup.get(groupId);
    if (children) children.push(node);
    else childrenByGroup.set(groupId, [node]);
  }

  const rows: CanvasNodePanelRow[] = [];
  for (const node of nodes) {
    const parentGroupId = node.metadata?.groupId;
    if (parentGroupId && groups.has(parentGroupId)) continue;

    if (node.type !== CanvasNodeType.Group) {
      if (matchingIds.has(node.id))
        rows.push({ node, depth: 0, hasChildren: false });
      continue;
    }

    const children = childrenByGroup.get(node.id) || [];
    if (!matchingIds.has(node.id) && children.length === 0) continue;
    rows.push({ node, depth: 0, hasChildren: children.length > 0 });
    if (options.collapsedGroupIds.has(node.id)) continue;
    for (const child of children)
      rows.push({ node: child, depth: 1, hasChildren: false });
  }

  return { filteredNodes, rows };
}

export function toggleCanvasNodeSelection(
  current: ReadonlySet<string>,
  nodeId: string,
) {
  const next = new Set(current);
  if (next.has(nodeId)) next.delete(nodeId);
  else next.add(nodeId);
  return next;
}

export function toggleVisibleCanvasNodeSelection(
  current: ReadonlySet<string>,
  visibleNodeIds: readonly string[],
) {
  const allVisibleSelected =
    visibleNodeIds.length > 0 &&
    visibleNodeIds.every((nodeId) => current.has(nodeId));
  const next = new Set(current);
  for (const nodeId of visibleNodeIds) {
    if (allVisibleSelected) next.delete(nodeId);
    else next.add(nodeId);
  }
  return next;
}
