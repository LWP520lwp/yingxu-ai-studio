import { describe, expect, it } from "vitest";
import { tidyCanvasNodes } from "@/lib/canvas/canvas-tidy-layout";
import { GROUP_WRAP_PADDING, GROUP_WRAP_TOP_PADDING } from "@/lib/canvas/canvas-node-geometry";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

const node = (id: string, x: number, y: number, patch: Partial<CanvasNodeData> = {}): CanvasNodeData => ({
    id, type: CanvasNodeType.Text, title: id, position: { x, y }, width: 220, height: 150,
    metadata: { content: `内容-${id}`, prompt: `提示词-${id}` }, ...patch,
});
const edge = (fromNodeId: string, toNodeId: string): CanvasConnection => ({ id: `${fromNodeId}-${toNodeId}`, fromNodeId, toNodeId });
const at = (nodes: CanvasNodeData[], id: string) => nodes.find((item) => item.id === id)!;
const overlaps = (a: CanvasNodeData, b: CanvasNodeData) => a.position.x < b.position.x + b.width && b.position.x < a.position.x + a.width && a.position.y < b.position.y + b.height && b.position.y < a.position.y + a.height;
const expectNoOverlap = (nodes: CanvasNodeData[]) => nodes.forEach((a, index) => nodes.slice(index + 1).forEach((b) => expect(overlaps(a, b), `${a.id} overlaps ${b.id}`).toBe(false)));
const positions = (nodes: CanvasNodeData[]) => Object.fromEntries(nodes.map((item) => [item.id, item.position]));

describe("topological canvas layout", () => {
    it("places mixed-size DAG layers left to right without overlap or data/connection loss", () => {
        const nodes = [node("source", 700, 500, { width: 500, height: 250 }), node("b", 20, 20), node("c", 20, 20, { height: 430 }), node("end", 0, 0), node("isolated", 0, 0, { type: "example:plugin" })];
        const connections = [edge("source", "b"), edge("source", "c"), edge("b", "end"), edge("c", "end")];
        const before = structuredClone(nodes), beforeConnections = structuredClone(connections);
        const result = tidyCanvasNodes(nodes, connections);
        expectNoOverlap(result);
        for (const connection of connections) {
            const source = at(result, connection.fromNodeId), target = at(result, connection.toNodeId);
            expect(target.position.x).toBeGreaterThan(source.position.x + source.width);
        }
        expect(at(result, "b").position.x).toBe(at(result, "c").position.x);
        expect(result.map((item) => item.id)).toEqual(nodes.map((item) => item.id));
        result.forEach((item) => {
            const original = at(nodes, item.id);
            expect({ ...item, position: original.position }).toEqual(original);
            expect(item.metadata).toBe(original.metadata);
        });
        expect(nodes).toEqual(before);
        expect(connections).toEqual(beforeConnections);
    });

    it("stably handles directed cycles, duplicates, self-links and missing endpoints", () => {
        const nodes = [node("c", 12, 10), node("a", 12, 10), node("b", 12, 10), node("tail", 12, 10)];
        const connections = [edge("a", "b"), edge("b", "c"), edge("c", "a"), edge("c", "tail"), edge("a", "b"), edge("a", "a"), edge("missing", "tail")];
        const result = tidyCanvasNodes(nodes, connections);
        expectNoOverlap(result);
        expect(result).toHaveLength(nodes.length);
        expect(positions(tidyCanvasNodes([...nodes].reverse(), [...connections].reverse()))).toEqual(positions(result));
        expect(tidyCanvasNodes(result, connections)).toBe(result);
        expect(at(result, "tail").position.x).toBeGreaterThan(at(result, "c").position.x);
    });

    it("moves only selected nodes and avoids fixed unselected nodes", () => {
        const nodes = [node("a", 0, 0), node("b", 10, 0), node("fixed", 360, 0, { height: 500 }), node("fixed-two", 0, 400)];
        const result = tidyCanvasNodes(nodes, [edge("a", "b")], new Set(["a", "b"]));
        expect(at(result, "fixed")).toBe(at(nodes, "fixed"));
        expect(at(result, "fixed-two")).toBe(at(nodes, "fixed-two"));
        expectNoOverlap(result);
        expect(at(result, "b").position.x).toBeGreaterThan(at(result, "a").position.x);
    });

    it("does not mutate frozen input so the existing history can restore original geometry", () => {
        const nodes = [node("a", 1000, 300), node("b", 0, 100)];
        nodes.forEach((item) => { Object.freeze(item.position); Object.freeze(item.metadata); Object.freeze(item); });
        Object.freeze(nodes);
        const result = tidyCanvasNodes(nodes, [edge("a", "b")]);
        expect(result).not.toBe(nodes);
        expect(at(nodes, "a").position).toEqual({ x: 1000, y: 300 });
        expect(at(nodes, "b").position).toEqual({ x: 0, y: 100 });
        expect(result.every((item) => Number.isFinite(item.position.x) && Number.isFinite(item.position.y))).toBe(true);
    });

    it("handles empty canvases and stale selections without replacing any node", () => {
        const empty: CanvasNodeData[] = [];
        expect(tidyCanvasNodes(empty, [])).toBe(empty);
        const nodes = [node("a", 0, 0)];
        expect(tidyCanvasNodes(nodes, [], new Set(["deleted"]))).toBe(nodes);
        expect(tidyCanvasNodes(nodes, [])).toBe(nodes);
    });
});

describe("groups remain intact", () => {
    const groupNodes = () => [
        node("group", -500, -500, { type: CanvasNodeType.Group, width: 10, height: 10, metadata: { content: "组说明" } }),
        node("left", 500, 250, { metadata: { groupId: "group", content: "左内容", images: [{ id: "image", content: "/api/assets/a/content", status: "success", naturalWidth: 20, naturalHeight: 30, storageKey: "", bytes: 20, mimeType: "image/png" }] } }),
        node("right", 800, 470, { width: 300, metadata: { groupId: "group", content: "右内容" } }),
        node("output", 0, 0),
    ];

    it("moves a group as one topology unit and wraps members with the existing padding", () => {
        const nodes = groupNodes(), connections = [edge("left", "right"), edge("right", "output")];
        const result = tidyCanvasNodes(nodes, connections);
        const left = at(result, "left"), right = at(result, "right"), group = at(result, "group"), output = at(result, "output");
        expect(right.position.x - left.position.x).toBe(300);
        expect(right.position.y - left.position.y).toBe(220);
        expect(group.position).toEqual({ x: left.position.x - GROUP_WRAP_PADDING, y: left.position.y - GROUP_WRAP_TOP_PADDING });
        expect(group.width).toBe(600 + GROUP_WRAP_PADDING * 2);
        expect(group.height).toBe(370 + GROUP_WRAP_TOP_PADDING + GROUP_WRAP_PADDING);
        expect(output.position.x).toBeGreaterThan(group.position.x + group.width);
        expectNoOverlap([group, output]);
        expect(left.metadata).toBe(at(nodes, "left").metadata);
        expect(right.metadata?.groupId).toBe("group");
        expect(tidyCanvasNodes(result, connections)).toBe(result);
    });

    it("expands a selected group member to the whole group and keeps outsiders fixed", () => {
        const nodes = groupNodes();
        const result = tidyCanvasNodes(nodes, [edge("right", "output")], new Set(["left"]));
        expect(at(result, "output")).toBe(at(nodes, "output"));
        const left = at(result, "left"), right = at(result, "right"), group = at(result, "group");
        expect(right.position.x - left.position.x).toBe(300);
        expect(right.position.y - left.position.y).toBe(220);
        expectNoOverlap([group, at(result, "output")]);
        expect(result.map((item) => item.id)).toEqual(nodes.map((item) => item.id));
        expect(result.map((item) => item.metadata)).toEqual(nodes.map((item) => item.metadata));
    });

    it("keeps an unselected group and all of its members unchanged", () => {
        const nodes = groupNodes();
        const result = tidyCanvasNodes(nodes, [], new Set(["output"]));
        for (const id of ["group", "left", "right"]) expect(at(result, id)).toBe(at(nodes, id));
    });

    it("keeps nested groups and orphan membership without dropping or rewriting content", () => {
        const nodes = [node("outer", 0, 0, { type: CanvasNodeType.Group }), node("inner", 0, 0, { type: CanvasNodeType.Group, metadata: { groupId: "outer" } }), node("child", 70, 100, { metadata: { groupId: "inner", content: "保留" } }), node("orphan", 70, 100, { metadata: { groupId: "missing", content: "孤立节点" } })];
        const result = tidyCanvasNodes(nodes, [edge("child", "orphan")]);
        expect(result).toHaveLength(4);
        expect(at(result, "child").metadata).toBe(at(nodes, "child").metadata);
        expect(at(result, "orphan").metadata?.groupId).toBe("missing");
        expectNoOverlap([at(result, "outer"), at(result, "orphan")]);
        expect(tidyCanvasNodes(result, [edge("child", "orphan")])).toBe(result);
    });
});
