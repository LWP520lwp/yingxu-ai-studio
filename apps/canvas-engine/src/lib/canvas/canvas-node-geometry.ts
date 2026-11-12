import {
    CanvasNodeType,
    type CanvasConnection,
    type CanvasNodeData,
    type ViewportTransform,
} from "@/types/canvas";

type Rect = { left: number; top: number; right: number; bottom: number };
type NodeFrame = Pick<CanvasNodeData, "position" | "width" | "height">;

const GROUP_INSET = 24;
const finite = (value: number, fallback = 0) =>
    Number.isFinite(value) ? value : fallback;

function rectOf(node: NodeFrame): Rect {
    const left = finite(node.position.x);
    const top = finite(node.position.y);
    return {
        left,
        top,
        right: left + Math.max(0, finite(node.width)),
        bottom: top + Math.max(0, finite(node.height)),
    };
}

function centerOf(node: NodeFrame) {
    const rect = rectOf(node);
    return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
}

function containsCenter(container: CanvasNodeData, candidate: CanvasNodeData) {
    const center = centerOf(candidate);
    const frame = rectOf(container);
    return (
        center.x >= frame.left &&
        center.x <= frame.right &&
        center.y >= frame.top &&
        center.y <= frame.bottom
    );
}

/** Return the enclosing world-space bounds; an empty collection has a zero frame. */
export function nodeBounds(nodes: CanvasNodeData[]) {
    if (!nodes.length) return { left: 0, top: 0, right: 0, bottom: 0 };
    const bounds: Rect = {
        left: Infinity,
        top: Infinity,
        right: -Infinity,
        bottom: -Infinity,
    };
    for (const node of nodes) {
        const frame = rectOf(node);
        bounds.left = Math.min(bounds.left, frame.left);
        bounds.top = Math.min(bounds.top, frame.top);
        bounds.right = Math.max(bounds.right, frame.right);
        bounds.bottom = Math.max(bounds.bottom, frame.bottom);
    }
    return bounds;
}

function selectedGroups(
    selectedIds: ReadonlySet<string>,
    nodes: CanvasNodeData[],
) {
    return new Set(
        nodes
            .filter(
                (node) =>
                    node.type === CanvasNodeType.Group &&
                    selectedIds.has(node.id),
            )
            .map((node) => node.id),
    );
}

function selectedMembers(
    selectedIds: ReadonlySet<string>,
    nodes: CanvasNodeData[],
) {
    const groupIds = selectedGroups(selectedIds, nodes);
    return nodes.filter(
        (node) =>
            node.type !== CanvasNodeType.Group &&
            (selectedIds.has(node.id) ||
                Boolean(
                    node.metadata?.groupId &&
                    groupIds.has(node.metadata.groupId),
                )),
    );
}

function referencedGroupIds(nodes: CanvasNodeData[]) {
    return new Set(
        nodes.flatMap((node) =>
            node.metadata?.groupId ? [node.metadata.groupId] : [],
        ),
    );
}

function unusedGroupIds(nodes: CanvasNodeData[], preserveId?: string) {
    const referenced = referencedGroupIds(nodes);
    return new Set(
        nodes
            .filter(
                (node) =>
                    node.type === CanvasNodeType.Group &&
                    node.id !== preserveId &&
                    !referenced.has(node.id),
            )
            .map((node) => node.id),
    );
}

function removeNodes(
    nodes: CanvasNodeData[],
    connections: CanvasConnection[],
    removedIds: ReadonlySet<string>,
) {
    return {
        nodes: nodes.filter((node) => !removedIds.has(node.id)),
        connections: connections.filter(
            (edge) =>
                !removedIds.has(edge.fromNodeId) &&
                !removedIds.has(edge.toNodeId),
        ),
    };
}

/** Find the topmost group whose frame contains the center of any dragged node. */
export function findGroupDropTarget(
    movedIds: ReadonlySet<string>,
    nodes: CanvasNodeData[],
) {
    if (
        nodes.some(
            (node) =>
                movedIds.has(node.id) && node.type === CanvasNodeType.Group,
        )
    )
        return null;
    const dragged = nodes.filter(
        (node) => movedIds.has(node.id) && node.type !== CanvasNodeType.Group,
    );
    if (!dragged.length) return null;
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const candidate = nodes[index];
        if (
            candidate.type === CanvasNodeType.Group &&
            !movedIds.has(candidate.id) &&
            dragged.some((node) => containsCenter(candidate, node))
        )
            return candidate;
    }
    return null;
}

/** Move dragged nodes into the usable interior of a group, preserving their relative layout. */
export function snapNodesIntoGroup(
    movedIds: ReadonlySet<string>,
    nodes: CanvasNodeData[],
    group: CanvasNodeData,
) {
    const dragged = nodes.filter(
        (node) => movedIds.has(node.id) && node.type !== CanvasNodeType.Group,
    );
    if (!dragged.length) return nodes;

    const content = nodeBounds(dragged);
    const frame = rectOf(group);
    const innerLeft = frame.left + GROUP_INSET;
    const innerRight = frame.right - GROUP_INSET;
    const innerTop = frame.top + GROUP_INSET;
    const innerBottom = frame.bottom - GROUP_INSET;
    const dx =
        content.right - content.left > innerRight - innerLeft
            ? innerLeft - content.left
            : content.left < innerLeft
              ? innerLeft - content.left
              : content.right > innerRight
                ? innerRight - content.right
                : 0;
    const dy =
        content.bottom - content.top > innerBottom - innerTop
            ? innerTop - content.top
            : content.top < innerTop
              ? innerTop - content.top
              : content.bottom > innerBottom
                ? innerBottom - content.bottom
                : 0;

    return nodes.map((node) => {
        if (!movedIds.has(node.id) || node.type === CanvasNodeType.Group)
            return node;
        const position = {
            x: finite(node.position.x) + dx,
            y: finite(node.position.y) + dy,
        };
        if (
            node.metadata?.groupId === group.id &&
            position.x === node.position.x &&
            position.y === node.position.y
        )
            return node;
        return {
            ...node,
            position,
            metadata: { ...node.metadata, groupId: group.id },
        };
    });
}

export const GROUP_WRAP_PADDING = 24;
export const GROUP_WRAP_TOP_PADDING = 52;

/** Resolve selected nodes and the direct non-group members of selected groups. */
export function collectGroupMemberNodes(
    selectedIds: ReadonlySet<string>,
    nodes: CanvasNodeData[],
) {
    return selectedMembers(selectedIds, nodes);
}

/** Compute a frame around members, including the standard header and body insets. */
export function getGroupWrapRect(members: CanvasNodeData[]) {
    const bounds = nodeBounds(members);
    return {
        x: bounds.left - GROUP_WRAP_PADDING,
        y: bounds.top - GROUP_WRAP_TOP_PADDING,
        width: bounds.right - bounds.left + GROUP_WRAP_PADDING * 2,
        height:
            bounds.bottom -
            bounds.top +
            GROUP_WRAP_TOP_PADDING +
            GROUP_WRAP_PADDING,
    };
}

export function canGroupSelectedNodes(
    selectedIds: ReadonlySet<string>,
    nodes: CanvasNodeData[],
) {
    const members = selectedMembers(selectedIds, nodes);
    if (members.length < 2) return false;
    const memberships = new Set(
        members.map((node) => node.metadata?.groupId || ""),
    );
    return memberships.size > 1 || memberships.has("");
}

export function canUngroupSelectedNodes(
    selectedIds: ReadonlySet<string>,
    nodes: CanvasNodeData[],
) {
    return nodes.some(
        (node) =>
            selectedIds.has(node.id) &&
            (node.type === CanvasNodeType.Group ||
                Boolean(node.metadata?.groupId)),
    );
}

export function applyGroupSelection(
    selectedIds: ReadonlySet<string>,
    nodes: CanvasNodeData[],
    connections: CanvasConnection[],
    group: CanvasNodeData,
) {
    const members = selectedMembers(selectedIds, nodes);
    if (
        members.length < 2 ||
        group.type !== CanvasNodeType.Group ||
        nodes.some((node) => node.id === group.id)
    )
        return null;

    const memberIds = new Set(members.map((node) => node.id));
    const selectedGroupIds = selectedGroups(selectedIds, nodes);
    const reassigned = nodes
        .filter((node) => !selectedGroupIds.has(node.id))
        .map((node) =>
            memberIds.has(node.id)
                ? { ...node, metadata: { ...node.metadata, groupId: group.id } }
                : node,
        );
    const firstMemberIndex = reassigned.findIndex((node) =>
        memberIds.has(node.id),
    );
    const ordered =
        firstMemberIndex < 0
            ? [...reassigned, group]
            : [
                  ...reassigned.slice(0, firstMemberIndex),
                  group,
                  ...reassigned.slice(firstMemberIndex),
              ];
    const removed = new Set([
        ...selectedGroupIds,
        ...unusedGroupIds(ordered, group.id),
    ]);
    const result = removeNodes(ordered, connections, removed);
    return { ...result, selectedIds: [group.id] };
}

export function applyUngroupSelection(
    selectedIds: ReadonlySet<string>,
    nodes: CanvasNodeData[],
    connections: CanvasConnection[],
) {
    const groups = selectedGroups(selectedIds, nodes);
    const hasGroupedSelection = nodes.some(
        (node) => selectedIds.has(node.id) && Boolean(node.metadata?.groupId),
    );
    if (!groups.size && !hasGroupedSelection) return null;

    const releasedIds = new Set<string>();
    const remaining = nodes
        .filter((node) => !groups.has(node.id))
        .map((node) => {
            const parentId = node.metadata?.groupId;
            if (
                !parentId ||
                (!groups.has(parentId) && !selectedIds.has(node.id))
            )
                return node;
            releasedIds.add(node.id);
            return {
                ...node,
                metadata: { ...node.metadata, groupId: undefined },
            };
        });
    const removed = new Set([...groups, ...unusedGroupIds(remaining)]);
    const result = removeNodes(remaining, connections, removed);
    const nextSelection = result.nodes
        .filter((node) => selectedIds.has(node.id) || releasedIds.has(node.id))
        .map((node) => node.id);
    return { ...result, selectedIds: nextSelection };
}

export function findContainingGroupId(
    node: CanvasNodeData,
    nodes: CanvasNodeData[],
) {
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const group = nodes[index];
        if (
            group.type === CanvasNodeType.Group &&
            group.id !== node.id &&
            containsCenter(group, node)
        )
            return group.id;
    }
    return undefined;
}

export type FocusFrame = {
    above?: number;
    below?: number;
    bottomInset?: number;
};

/** Center a node and its measured overlays within the usable portion of the canvas. */
export function focusViewportForNode(
    node: NodeFrame,
    size: { width: number; height: number },
    frame: FocusFrame = {},
): ViewportTransform {
    const bounds = rectOf(node);
    const width = Math.max(0, finite(size.width));
    const height = Math.max(0, finite(size.height));
    const above = Math.max(0, finite(frame.above ?? 0));
    const below = Math.max(0, finite(frame.below ?? 0));
    const availableHeight = Math.max(
        0,
        height - Math.min(height, Math.max(0, finite(frame.bottomInset ?? 0))),
    );
    const nodeWidth = Math.max(1, bounds.right - bounds.left);
    const nodeHeight = Math.max(1, bounds.bottom - bounds.top);
    const center = {
        x: (bounds.left + bounds.right) / 2,
        y: (bounds.top + bounds.bottom) / 2,
    };
    const room = availableHeight * 0.92 - above - below;
    const scale = Math.min(
        Math.max(
            Math.min(
                (width * 0.6) / nodeWidth,
                (height * 0.6) / nodeHeight,
                room / nodeHeight,
            ),
            0.05,
        ),
        1,
    );
    const contentHeight = above + nodeHeight * scale + below;
    const spare = availableHeight - contentHeight;
    const top = spare * (below > 0 && spare > 0 ? 0.75 : 0.5);
    return {
        x: width / 2 - center.x * scale,
        y: top + contentHeight / 2 - center.y * scale - (below - above) / 2,
        k: scale,
    };
}
