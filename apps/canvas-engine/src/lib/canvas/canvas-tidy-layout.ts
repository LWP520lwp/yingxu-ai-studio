import { getGroupWrapRect } from "@/lib/canvas/canvas-node-geometry";
import {
    CanvasNodeType,
    type CanvasConnection,
    type CanvasNodeData,
} from "@/types/canvas";

const COLUMN_GAP = 140;
const ROW_GAP = 64;

type Rect = { x: number; y: number; width: number; height: number };
type LayoutUnit = {
    id: string;
    nodeIds: string[];
    nodes: CanvasNodeData[];
    bounds: Rect;
};
type OffsetRange = { start: number; end: number };

const compareIds = (left: string, right: string) =>
    left < right ? -1 : left > right ? 1 : 0;

function boundsOf(nodes: CanvasNodeData[]): Rect {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const node of nodes) {
        left = Math.min(left, node.position.x);
        top = Math.min(top, node.position.y);
        right = Math.max(right, node.position.x + node.width);
        bottom = Math.max(bottom, node.position.y + node.height);
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
}

function overlapsWithClearance(left: Rect, right: Rect, clearance: number) {
    return (
        left.x + left.width + clearance > right.x &&
        right.x + right.width + clearance > left.x
    );
}

function collisionOffset(moving: Rect[], fixed: Rect[]) {
    const blocked: OffsetRange[] = [];
    for (const source of moving) {
        for (const obstacle of fixed) {
            if (!overlapsWithClearance(source, obstacle, ROW_GAP)) continue;
            blocked.push({
                start: obstacle.y - source.y - source.height - ROW_GAP,
                end: obstacle.y + obstacle.height + ROW_GAP - source.y,
            });
        }
    }

    blocked.sort(
        (left, right) => left.start - right.start || left.end - right.end,
    );
    let offset = 0;
    for (const range of blocked) {
        if (offset > range.start && offset < range.end) offset = range.end;
    }
    return offset;
}

function makeDisjointSet(ids: string[]) {
    const parent = new Map(ids.map((id) => [id, id]));
    const find = (id: string) => {
        let root = id;
        while (parent.get(root) !== root) root = parent.get(root)!;
        while (parent.get(id) !== id) {
            const next = parent.get(id)!;
            parent.set(id, root);
            id = next;
        }
        return root;
    };
    const join = (left: string, right: string) => {
        const leftRoot = find(left);
        const rightRoot = find(right);
        if (leftRoot === rightRoot) return;
        const [root, child] = [leftRoot, rightRoot].sort(compareIds);
        parent.set(child, root);
    };
    return { find, join };
}

function groupUnits(nodes: CanvasNodeData[]) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const sets = makeDisjointSet(nodes.map((node) => node.id));
    const children = new Map<string, CanvasNodeData[]>();

    for (const node of nodes) {
        const parentId = node.metadata?.groupId;
        const parent = parentId ? byId.get(parentId) : undefined;
        if (
            !parent ||
            parent.type !== CanvasNodeType.Group ||
            parent.id === node.id
        )
            continue;
        sets.join(parent.id, node.id);
        const entries = children.get(parent.id) || [];
        entries.push(node);
        children.set(parent.id, entries);
    }

    const grouped = new Map<string, CanvasNodeData[]>();
    for (const node of nodes) {
        const root = sets.find(node.id);
        const entries = grouped.get(root) || [];
        entries.push(node);
        grouped.set(root, entries);
    }
    return { byId, children, grouped };
}

function findCyclicGroups(
    nodes: CanvasNodeData[],
    children: Map<string, CanvasNodeData[]>,
) {
    const state = new Map<string, 0 | 1 | 2>();
    const path: string[] = [];
    const cyclic = new Set<string>();

    const visit = (id: string) => {
        const current = state.get(id) || 0;
        if (current === 2) return;
        if (current === 1) {
            const cycleStart = path.indexOf(id);
            path.slice(cycleStart).forEach((cycleId) => cyclic.add(cycleId));
            return;
        }
        state.set(id, 1);
        path.push(id);
        for (const child of children.get(id) || []) {
            if (child.type === CanvasNodeType.Group) visit(child.id);
        }
        path.pop();
        state.set(id, 2);
    };

    for (const node of nodes) {
        if (node.type === CanvasNodeType.Group) visit(node.id);
    }
    return cyclic;
}

function refreshGroupFrames(
    nodes: CanvasNodeData[],
    children: Map<string, CanvasNodeData[]>,
) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const refreshed = new Map<string, CanvasNodeData>();
    const cyclic = findCyclicGroups(nodes, children);

    const visit = (id: string, path: ReadonlySet<string>): CanvasNodeData => {
        const cached = refreshed.get(id);
        if (cached) return cached;
        const node = byId.get(id)!;
        if (node.type !== CanvasNodeType.Group) return node;
        if (cyclic.has(id)) {
            refreshed.set(id, node);
            return node;
        }

        const direct = children.get(id) || [];
        if (!direct.length) return node;

        const nextPath = new Set(path);
        nextPath.add(id);
        const contents = direct.map((child) => {
            // Malformed cyclic memberships are retained as-is at the cycle edge.
            return nextPath.has(child.id) ? child : visit(child.id, nextPath);
        });
        const frame = getGroupWrapRect(contents);
        const result = {
            ...node,
            position: { x: frame.x, y: frame.y },
            width: frame.width,
            height: frame.height,
        };
        refreshed.set(id, result);
        return result;
    };

    for (const node of nodes) {
        if (node.type === CanvasNodeType.Group) visit(node.id, new Set());
        else refreshed.set(node.id, node);
    }
    return refreshed;
}

function assignLayers(
    units: LayoutUnit[],
    connections: CanvasConnection[],
    unitForNode: Map<string, string>,
) {
    const ids = units.map((unit) => unit.id).sort(compareIds);
    const remaining = new Set(ids);
    const incoming = new Map(ids.map((id) => [id, 0]));
    const outgoing = new Map(ids.map((id) => [id, new Set<string>()]));

    for (const edge of connections) {
        const from = unitForNode.get(edge.fromNodeId);
        const to = unitForNode.get(edge.toNodeId);
        if (
            !from ||
            !to ||
            from === to ||
            !remaining.has(from) ||
            !remaining.has(to) ||
            outgoing.get(from)!.has(to)
        )
            continue;
        outgoing.get(from)!.add(to);
        incoming.set(to, incoming.get(to)! + 1);
    }

    const ranks = new Map(ids.map((id) => [id, 0]));
    const ready = ids.filter((id) => incoming.get(id) === 0);
    while (remaining.size) {
        // If a cycle has no source, start at its stable smallest ID and continue
        // laying out the remaining graph instead of dropping cyclic nodes.
        const id = ready.shift() || [...remaining].sort(compareIds)[0];
        if (!remaining.delete(id)) continue;
        const targets = [...outgoing.get(id)!].sort(compareIds);
        for (const target of targets) {
            if (!remaining.has(target)) continue;
            ranks.set(target, Math.max(ranks.get(target)!, ranks.get(id)! + 1));
            incoming.set(target, incoming.get(target)! - 1);
            if (incoming.get(target) === 0) {
                ready.push(target);
                ready.sort(compareIds);
            }
        }
    }
    return ranks;
}

/** Arrange graph units in deterministic columns while preserving the project data. */
export function tidyCanvasNodes(
    nodes: CanvasNodeData[],
    connections: CanvasConnection[],
    selectedIds: ReadonlySet<string> = new Set(),
): CanvasNodeData[] {
    if (!nodes.length) return nodes;

    const { grouped, children } = groupUnits(nodes);
    const refreshedNodes = refreshGroupFrames(nodes, children);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const unitForNode = new Map<string, string>();
    const units: LayoutUnit[] = [];

    for (const [id, members] of grouped) {
        const nodeIds = members.map((node) => node.id).sort(compareIds);
        nodeIds.forEach((nodeId) => unitForNode.set(nodeId, id));
        const isMoving =
            !selectedIds.size ||
            nodeIds.some((nodeId) => selectedIds.has(nodeId));
        const unitNodes = isMoving
            ? members.map((node) => refreshedNodes.get(node.id) || node)
            : members;
        units.push({
            id,
            nodeIds,
            nodes: unitNodes,
            bounds: boundsOf(unitNodes),
        });
    }

    const moving = units
        .filter(
            (unit) =>
                !selectedIds.size ||
                unit.nodeIds.some((id) => selectedIds.has(id)),
        )
        .sort((left, right) => compareIds(left.id, right.id));
    if (!moving.length) return nodes;

    const ranks = assignLayers(moving, connections, unitForNode);
    const columns = new Map<number, LayoutUnit[]>();
    for (const unit of moving) {
        const rank = ranks.get(unit.id)!;
        const column = columns.get(rank) || [];
        column.push(unit);
        columns.set(rank, column);
    }
    for (const column of columns.values())
        column.sort((left, right) => compareIds(left.id, right.id));

    const origin = moving.reduce(
        (point, unit) => ({
            x: Math.min(point.x, unit.bounds.x),
            y: Math.min(point.y, unit.bounds.y),
        }),
        { x: Infinity, y: Infinity },
    );
    const arranged: Rect[] = [];
    const destination = new Map<string, Rect>();
    let x = origin.x;
    for (const [, column] of [...columns].sort(
        ([left], [right]) => left - right,
    )) {
        let y = origin.y;
        for (const unit of column) {
            const rect = { ...unit.bounds, x, y };
            arranged.push(rect);
            destination.set(unit.id, rect);
            y += unit.bounds.height + ROW_GAP;
        }
        x += Math.max(...column.map((unit) => unit.bounds.width)) + COLUMN_GAP;
    }

    const stationary = units
        .filter((unit) => !destination.has(unit.id))
        .map((unit) => unit.bounds);
    const offsetY = collisionOffset(arranged, stationary);
    const updated = new Map<string, CanvasNodeData>();

    for (const unit of moving) {
        const target = destination.get(unit.id)!;
        const dx = target.x - unit.bounds.x;
        const dy = target.y + offsetY - unit.bounds.y;
        for (const layoutNode of unit.nodes) {
            const original = nodeById.get(layoutNode.id)!;
            const position = {
                x: layoutNode.position.x + dx,
                y: layoutNode.position.y + dy,
            };
            if (
                position.x !== original.position.x ||
                position.y !== original.position.y ||
                layoutNode.width !== original.width ||
                layoutNode.height !== original.height
            ) {
                updated.set(original.id, { ...layoutNode, position });
            }
        }
    }

    return updated.size
        ? nodes.map((node) => updated.get(node.id) || node)
        : nodes;
}
