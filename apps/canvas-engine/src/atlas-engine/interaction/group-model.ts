const GROUP_KIND = "group";
const GROUP_BODY_INSET = 24;
const GROUP_HEADER_INSET = 52;
const MAX_COORDINATE = 1e12;

export type AtlasGeometryNode = Readonly<{
  id: string;
  kind: string;
  position: Readonly<{ x: number; y: number }>;
  width: number;
  height: number;
  groupId?: string;
}>;

export type AtlasBounds = Readonly<{
  left: number;
  top: number;
  right: number;
  bottom: number;
}>;

export type AtlasGroupFrame = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type AtlasViewportFrame = Readonly<{
  above?: number;
  below?: number;
  bottomInset?: number;
}>;

export function atlasNodeBounds(
  nodes: readonly AtlasGeometryNode[],
): AtlasBounds {
  if (!nodes.length) return { left: 0, top: 0, right: 0, bottom: 0 };
  let left = MAX_COORDINATE;
  let top = MAX_COORDINATE;
  let right = -MAX_COORDINATE;
  let bottom = -MAX_COORDINATE;

  for (const node of nodes) {
    const x = finiteCoordinate(node.position.x);
    const y = finiteCoordinate(node.position.y);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x + finiteExtent(node.width));
    bottom = Math.max(bottom, y + finiteExtent(node.height));
  }

  return { left, top, right, bottom };
}

export function atlasGroupFrame(
  nodes: readonly AtlasGeometryNode[],
): AtlasGroupFrame {
  const bounds = atlasNodeBounds(nodes);
  return {
    x: bounds.left - GROUP_BODY_INSET,
    y: bounds.top - GROUP_HEADER_INSET,
    width: bounds.right - bounds.left + GROUP_BODY_INSET * 2,
    height: bounds.bottom - bounds.top + GROUP_HEADER_INSET + GROUP_BODY_INSET,
  };
}

export function collectAtlasGroupMembers(
  selectedIds: ReadonlySet<string>,
  nodes: readonly AtlasGeometryNode[],
): AtlasGeometryNode[] {
  const selectedGroups = selectedGroupIds(selectedIds, nodes);
  return nodes.filter(
    (node) =>
      node.kind !== GROUP_KIND &&
      (selectedIds.has(node.id) ||
        (node.groupId !== undefined && selectedGroups.has(node.groupId))),
  );
}

export function canAtlasGroupSelection(
  selectedIds: ReadonlySet<string>,
  nodes: readonly AtlasGeometryNode[],
): boolean {
  const members = collectAtlasGroupMembers(selectedIds, nodes);
  if (members.length < 2) return false;
  const memberships = new Set(members.map((node) => node.groupId ?? ""));
  return memberships.size > 1 || memberships.has("");
}

export function canAtlasUngroupSelection(
  selectedIds: ReadonlySet<string>,
  nodes: readonly AtlasGeometryNode[],
): boolean {
  return nodes.some(
    (node) =>
      selectedIds.has(node.id) &&
      (node.kind === GROUP_KIND || Boolean(node.groupId)),
  );
}

export type AtlasGroupMutation = Readonly<{
  nodes: readonly AtlasGeometryNode[];
  removedNodeIds: ReadonlySet<string>;
  selectedIds: readonly string[];
}>;

export function groupAtlasSelection(
  selectedIds: ReadonlySet<string>,
  nodes: readonly AtlasGeometryNode[],
  group: AtlasGeometryNode,
): AtlasGroupMutation | null {
  const members = collectAtlasGroupMembers(selectedIds, nodes);
  if (
    members.length < 2 ||
    group.kind !== GROUP_KIND ||
    nodes.some((node) => node.id === group.id)
  ) {
    return null;
  }

  const memberIds = new Set(members.map((node) => node.id));
  const selectedGroups = selectedGroupIds(selectedIds, nodes);
  const surviving = nodes
    .filter((node) => !selectedGroups.has(node.id))
    .map((node) =>
      memberIds.has(node.id) ? { ...node, groupId: group.id } : node,
    );
  const firstMember = surviving.findIndex((node) => memberIds.has(node.id));
  const ordered =
    firstMember < 0
      ? [...surviving, group]
      : [
          ...surviving.slice(0, firstMember),
          group,
          ...surviving.slice(firstMember),
        ];
  const removedNodeIds = new Set([
    ...selectedGroups,
    ...unreferencedGroupIds(ordered, group.id),
  ]);

  return {
    nodes: ordered.filter((node) => !removedNodeIds.has(node.id)),
    removedNodeIds,
    selectedIds: [group.id],
  };
}

export function ungroupAtlasSelection(
  selectedIds: ReadonlySet<string>,
  nodes: readonly AtlasGeometryNode[],
): AtlasGroupMutation | null {
  const selectedGroups = selectedGroupIds(selectedIds, nodes);
  const hasGroupedSelection = nodes.some(
    (node) => selectedIds.has(node.id) && Boolean(node.groupId),
  );
  if (!selectedGroups.size && !hasGroupedSelection) return null;

  const releasedIds = new Set<string>();
  const surviving = nodes
    .filter((node) => !selectedGroups.has(node.id))
    .map((node) => {
      const parentRemoved =
        node.groupId !== undefined && selectedGroups.has(node.groupId);
      const explicitlyReleased =
        selectedIds.has(node.id) && Boolean(node.groupId);
      if (!parentRemoved && !explicitlyReleased) return node;
      releasedIds.add(node.id);
      return { ...node, groupId: undefined };
    });
  const removedNodeIds = new Set(unreferencedGroupIds(surviving));
  const resultNodes = surviving.filter((node) => !removedNodeIds.has(node.id));

  return {
    nodes: resultNodes,
    removedNodeIds: new Set([...selectedGroups, ...removedNodeIds]),
    selectedIds: resultNodes
      .filter((node) => selectedIds.has(node.id) || releasedIds.has(node.id))
      .map((node) => node.id),
  };
}

export function fitAtlasViewportForNode(
  node: Pick<AtlasGeometryNode, "position" | "width" | "height">,
  viewportSize: Readonly<{ width: number; height: number }>,
  overlays: AtlasViewportFrame = {},
): Readonly<{ x: number; y: number; scale: number }> {
  const left = finiteCoordinate(node.position.x);
  const top = finiteCoordinate(node.position.y);
  const width = Math.max(1, finiteExtent(node.width));
  const height = Math.max(1, finiteExtent(node.height));
  const canvasWidth = finiteExtent(viewportSize.width);
  const canvasHeight = finiteExtent(viewportSize.height);
  const above = finiteExtent(overlays.above ?? 0);
  const below = finiteExtent(overlays.below ?? 0);
  const bottomInset = Math.min(
    canvasHeight,
    finiteExtent(overlays.bottomInset ?? 0),
  );
  const usableHeight = Math.max(0, canvasHeight - bottomInset);
  const verticalRoom = usableHeight * 0.92 - above - below;
  const scale = clamp(
    Math.min(
      (canvasWidth * 0.6) / width,
      (canvasHeight * 0.6) / height,
      verticalRoom / height,
    ),
    0.05,
    1,
  );
  const contentHeight = above + height * scale + below;
  const spareHeight = usableHeight - contentHeight;
  const topOffset = spareHeight * (below > 0 && spareHeight > 0 ? 0.75 : 0.5);
  const centerX = left + width / 2;
  const centerY = top + height / 2;

  return {
    x: canvasWidth / 2 - centerX * scale,
    y: topOffset + contentHeight / 2 - centerY * scale - (below - above) / 2,
    scale,
  };
}

function selectedGroupIds(
  selectedIds: ReadonlySet<string>,
  nodes: readonly AtlasGeometryNode[],
) {
  const groups = new Set<string>();
  for (const node of nodes) {
    if (node.kind === GROUP_KIND && selectedIds.has(node.id))
      groups.add(node.id);
  }
  return groups;
}

function unreferencedGroupIds(
  nodes: readonly AtlasGeometryNode[],
  preservedId?: string,
) {
  const referenced = new Set(
    nodes.flatMap((node) => (node.groupId ? [node.groupId] : [])),
  );
  return nodes
    .filter(
      (node) =>
        node.kind === GROUP_KIND &&
        node.id !== preservedId &&
        !referenced.has(node.id),
    )
    .map((node) => node.id);
}

function finiteCoordinate(value: number): number {
  return Number.isFinite(value)
    ? clamp(value, -MAX_COORDINATE, MAX_COORDINATE)
    : 0;
}

function finiteExtent(value: number): number {
  return Number.isFinite(value) ? clamp(value, 0, MAX_COORDINATE) : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
