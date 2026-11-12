import { describe, expect, it, vi } from "vitest";

import { applyCanvasAgentOps, summarizeCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

vi.mock("@/i18n", () => ({ default: { t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue || _key } }));

const node = (id: string, type: CanvasNodeData["type"] = CanvasNodeType.Text): CanvasNodeData => ({
    id, type, title: id, position: { x: 0, y: 0 }, width: 120, height: 80, metadata: { content: id },
});

const snapshot = (patch: Partial<CanvasAgentSnapshot> = {}): CanvasAgentSnapshot => ({
    projectId: "project",
    title: "项目",
    nodes: [node("a"), node("b"), node("config", CanvasNodeType.Config)],
    connections: [{ id: "a-b", fromNodeId: "a", toNodeId: "b" }],
    selectedNodeIds: ["a"],
    viewport: { x: 10, y: 20, k: 1 },
    ...patch,
});

describe("canvas agent operation reducer", () => {
    it("applies operations in order and retains graph identity and metadata", () => {
        const before = snapshot();
        const result = applyCanvasAgentOps(before, [
            { type: "add_node", id: "c", title: "第三个节点", position: { x: 40, y: 60 } },
            { type: "connect_nodes", id: "b-c", fromNodeId: "b", toNodeId: "c" },
            { type: "update_node", id: "c", patch: { title: "更新节点", metadata: { prompt: "提示词" } } },
            { type: "select_nodes", ids: ["missing", "c", "c"] },
        ]);
        expect(result.nodes.map((item) => item.id)).toEqual(["a", "b", "config", "c"]);
        expect(result.nodes[3]).toMatchObject({ id: "c", title: "更新节点", position: { x: 40, y: 60 }, metadata: { prompt: "提示词" } });
        expect(result.connections.map((item) => [item.fromNodeId, item.toNodeId])).toEqual([["a", "b"], ["b", "c"]]);
        expect(result.selectedNodeIds).toEqual(["c"]);
        expect(before.nodes).toHaveLength(3);
        expect(before.connections).toHaveLength(1);
    });

    it("avoids duplicate IDs, invalid sizes and non-finite canvas coordinates", () => {
        const before = snapshot();
        const result = applyCanvasAgentOps(before, [
            { type: "add_node", id: "a", width: -1, height: Number.NaN, x: Number.NaN, y: 12 },
            { type: "update_node", id: "b", patch: { id: "a", position: { x: Infinity, y: -Infinity }, width: 0 } },
            { type: "set_viewport", viewport: { x: Number.NaN, y: 12, k: 99 } },
        ]);
        expect(new Set(result.nodes.map((item) => item.id)).size).toBe(result.nodes.length);
        expect(result.nodes[3]).toMatchObject({ width: 340, height: 240, position: { x: 0, y: 12 } });
        expect(result.nodes[1]).toMatchObject({ id: "b", position: { x: 0, y: 0 }, width: 120 });
        expect(result.viewport).toEqual({ x: 0, y: 12, k: 5 });
    });

    it("removes deleted nodes and their edges and selection without touching unrelated nodes", () => {
        const before = snapshot({
            connections: [
                { id: "a-b", fromNodeId: "a", toNodeId: "b" },
                { id: "b-config", fromNodeId: "b", toNodeId: "config" },
            ],
            selectedNodeIds: ["a", "b", "missing"],
        });
        const result = applyCanvasAgentOps(before, [{ type: "delete_node", id: "b" }]);
        expect(result.nodes.map((item) => item.id)).toEqual(["a", "config"]);
        expect(result.connections).toEqual([]);
        expect(result.selectedNodeIds).toEqual(["a"]);
    });

    it("keeps later operations consistent with indexes after a node and edge are removed", () => {
        const before = snapshot({
            connections: [
                { id: "a-b", fromNodeId: "a", toNodeId: "b" },
                { id: "b-config", fromNodeId: "b", toNodeId: "config" },
            ],
            selectedNodeIds: ["a", "b"],
        });
        const result = applyCanvasAgentOps(before, [
            { type: "delete_node", id: "b" },
            { type: "add_node", id: "b", title: "recreated" },
            { type: "connect_nodes", id: "new-link", fromNodeId: "a", toNodeId: "b" },
            { type: "connect_nodes", id: "duplicate-link", fromNodeId: "a", toNodeId: "b" },
        ]);

        expect(result.nodes.map((item) => item.id)).toEqual(["a", "config", "b"]);
        expect(result.connections).toEqual([{ id: "new-link", fromNodeId: "a", toNodeId: "b" }]);
        expect(result.selectedNodeIds).toEqual(["b"]);
    });

    it("preserves input collection identity for an empty or no-op transaction", () => {
        const before = snapshot();
        const result = applyCanvasAgentOps(before, [
            { type: "delete_node", id: "missing" },
            { type: "connect_nodes", fromNodeId: "a", toNodeId: "missing" },
            { type: "select_nodes", ids: ["a"] },
        ]);

        expect(result.nodes).toBe(before.nodes);
        expect(result.connections).toBe(before.connections);
        expect(result.selectedNodeIds).toBe(before.selectedNodeIds);
        expect(result.viewport).toBe(before.viewport);
    });

    it("rejects self and dangling links and prevents connection ID collisions", () => {
        const result = applyCanvasAgentOps(snapshot(), [
            { type: "connect_nodes", fromNodeId: "a", toNodeId: "a" },
            { type: "connect_nodes", fromNodeId: "a", toNodeId: "missing" },
            { type: "connect_nodes", id: "a-b", fromNodeId: "b", toNodeId: "config" },
            { type: "connect_nodes", fromNodeId: "a", toNodeId: "b" },
        ]);
        expect(result.connections).toHaveLength(2);
        expect(new Set(result.connections.map((item) => item.id)).size).toBe(2);
        expect(result.connections[1]).toMatchObject({ fromNodeId: "b", toNodeId: "config" });
    });

    it("summarizes known operation counts and ignores missing input", () => {
        const ops: CanvasAgentOp[] = [{ type: "add_node" }, { type: "add_node" }, { type: "run_generation", nodeId: "a" }];
        expect(summarizeCanvasAgentOps(ops)).toBe("add_node 2，run_generation 1");
        expect(summarizeCanvasAgentOps(undefined)).toBe("");
    });
});
