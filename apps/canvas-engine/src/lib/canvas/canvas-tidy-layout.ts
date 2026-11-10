import { getGroupWrapRect, nodeBounds } from "@/lib/canvas/canvas-node-geometry";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

const COLUMN_GAP = 140;
const ROW_GAP = 64;
type Rect = { x: number; y: number; width: number; height: number };
type Unit = { id: string; nodes: CanvasNodeData[]; rect: Rect };

const boundsOf = (nodes: CanvasNodeData[]): Rect => {
    const bounds = nodeBounds(nodes);
    return { x: bounds.left, y: bounds.top, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top };
};

/**
 * Arrange the selected units (or the entire canvas) without changing IDs,
 * content, membership or connections. A group is one unit, even when only a
 * member is selected, so tidying cannot pull a member out of its group.
 */
export function tidyCanvasNodes(nodes: CanvasNodeData[], connections: CanvasConnection[], selectedIds: ReadonlySet<string> = new Set()): CanvasNodeData[] {
    if (!nodes.length) return nodes;
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const parents = new Map(nodes.map((node) => [node.id, node.id]));
    const find = (id: string): string => {
        let root = id;
        while (parents.get(root) !== root) root = parents.get(root)!;
        while (id !== root) { const next = parents.get(id)!; parents.set(id, root); id = next; }
        return root;
    };
    const children = new Map<string, CanvasNodeData[]>();
    for (const node of nodes) {
        const group = byId.get(node.metadata?.groupId || "");
        if (!group || group.type !== CanvasNodeType.Group || group.id === node.id) continue;
        const childRoot = find(node.id), groupRoot = find(group.id);
        if (childRoot !== groupRoot) parents.set(childRoot, groupRoot);
        children.set(group.id, [...(children.get(group.id) || []), node]);
    }
    const members = new Map<string, CanvasNodeData[]>();
    for (const node of nodes) {
        const root = find(node.id);
        members.set(root, [...(members.get(root) || []), node]);
    }

    // Refresh group geometry bottom-up. The visited set also makes malformed
    // nested membership cycles harmless instead of losing or recursing on nodes.
    const geometry = new Map<string, CanvasNodeData>();
    const wrapGroup = (node: CanvasNodeData, visiting: Set<string>): CanvasNodeData => {
        const cached = geometry.get(node.id);
        if (cached) return cached;
        if (node.type !== CanvasNodeType.Group || visiting.has(node.id)) return node;
        const direct = children.get(node.id) || [];
        if (!direct.length) return node;
        const seen = new Set(visiting); seen.add(node.id);
        const content = direct.filter((child) => !seen.has(child.id)).map((child) => wrapGroup(child, seen));
        if (!content.length) return node;
        const rect = getGroupWrapRect(content);
        const wrapped = { ...node, position: { x: rect.x, y: rect.y }, width: rect.width, height: rect.height };
        geometry.set(node.id, wrapped);
        return wrapped;
    };

    const units: Unit[] = [], unitForNode = new Map<string, string>();
    for (const grouped of members.values()) {
        const id = grouped.map((node) => node.id).sort()[0];
        const movable = !selectedIds.size || grouped.some((node) => selectedIds.has(node.id));
        const content = movable ? grouped.map((node) => wrapGroup(node, new Set())) : grouped;
        units.push({ id, nodes: content, rect: boundsOf(content) });
        grouped.forEach((node) => unitForNode.set(node.id, id));
    }
    const moving = units.filter((unit) => !selectedIds.size || unit.nodes.some((node) => selectedIds.has(node.id))).sort((a, b) => a.id.localeCompare(b.id));
    if (!moving.length) return nodes;
    const movingIds = new Set(moving.map((unit) => unit.id));
    const outgoing = new Map(moving.map((unit) => [unit.id, new Set<string>()]));
    const incoming = new Map(moving.map((unit) => [unit.id, 0]));
    for (const connection of connections) {
        const from = unitForNode.get(connection.fromNodeId), to = unitForNode.get(connection.toNodeId);
        if (!from || !to || from === to || !movingIds.has(from) || !movingIds.has(to) || outgoing.get(from)!.has(to)) continue;
        outgoing.get(from)!.add(to); incoming.set(to, incoming.get(to)! + 1);
    }

    const ranks = new Map(moving.map((unit) => [unit.id, 0]));
    const remaining = new Set(moving.map((unit) => unit.id));
    const ready = moving.filter((unit) => incoming.get(unit.id) === 0).map((unit) => unit.id);
    while (remaining.size) {
        // A directed cycle has no zero-indegree node. Break it at the stable ID;
        // all nodes still receive a position, and repeating tidy is deterministic.
        const id = ready.shift() || [...remaining].sort()[0];
        if (!remaining.delete(id)) continue;
        for (const target of outgoing.get(id)!) {
            if (!remaining.has(target)) continue;
            ranks.set(target, Math.max(ranks.get(target)!, ranks.get(id)! + 1));
            incoming.set(target, incoming.get(target)! - 1);
            if (incoming.get(target) === 0) { ready.push(target); ready.sort(); }
        }
    }
    const columns = new Map<number, Unit[]>();
    for (const unit of moving) {
        const rank = ranks.get(unit.id)!;
        columns.set(rank, [...(columns.get(rank) || []), unit]);
    }
    const originX = Math.min(...moving.map((unit) => unit.rect.x));
    const originY = Math.min(...moving.map((unit) => unit.rect.y));
    const positions = new Map<string, Rect>();
    let x = originX;
    for (const [, column] of [...columns].sort(([a], [b]) => a - b)) {
        let y = originY;
        for (const unit of column) {
            positions.set(unit.id, { ...unit.rect, x, y });
            y += unit.rect.height + ROW_GAP;
        }
        x += Math.max(...column.map((unit) => unit.rect.width)) + COLUMN_GAP;
    }

    // Preserve unselected nodes exactly. Translate the arranged block downward
    // only as far as needed to avoid every stationary group/node rectangle.
    const blockedOffsets: Array<{ start: number; end: number }> = [];
    for (const obstacle of units.filter((unit) => !movingIds.has(unit.id))) {
        for (const rect of positions.values()) {
            if (rect.x + rect.width + ROW_GAP <= obstacle.rect.x || obstacle.rect.x + obstacle.rect.width + ROW_GAP <= rect.x) continue;
            blockedOffsets.push({ start: obstacle.rect.y - rect.y - rect.height - ROW_GAP, end: obstacle.rect.y + obstacle.rect.height + ROW_GAP - rect.y });
        }
    }
    let offsetY = 0;
    for (const interval of blockedOffsets.sort((a, b) => a.start - b.start)) {
        if (offsetY > interval.start && offsetY < interval.end) offsetY = interval.end;
    }
    const updates = new Map<string, CanvasNodeData>();
    for (const unit of moving) {
        const rect = positions.get(unit.id)!;
        const dx = rect.x - unit.rect.x, dy = rect.y + offsetY - unit.rect.y;
        for (const node of unit.nodes) {
            const original = byId.get(node.id)!;
            const position = { x: node.position.x + dx, y: node.position.y + dy };
            if (position.x !== original.position.x || position.y !== original.position.y || node.width !== original.width || node.height !== original.height) {
                updates.set(node.id, { ...node, position });
            }
        }
    }
    return updates.size ? nodes.map((node) => updates.get(node.id) || node) : nodes;
}
