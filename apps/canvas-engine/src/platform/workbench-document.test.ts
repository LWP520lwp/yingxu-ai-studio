import { describe, expect, it } from "vitest";

import {
    createWorkbenchDocument,
    nodeCenter,
    normalizeViewport,
    reduceWorkbenchDocument,
    validateWorkbenchDocument,
    type WorkbenchDocument,
} from "@/atlas-engine/document/workbench-document";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

const node = (id: string, x = 0): CanvasNodeData => ({
    id, type: "text", title: id, position: { x, y: 20 }, width: 320, height: 180,
    metadata: { content: `content:${id}` },
});
const connection = (id: string, fromNodeId: string, toNodeId: string): CanvasConnection => ({ id, fromNodeId, toNodeId });
const document = (): WorkbenchDocument => createWorkbenchDocument({ id: "doc", nodes: [node("a"), node("b", 400), node("c", 800)] });

describe("workbench document domain", () => {
    it("normalizes initialization and isolates persisted snapshots from their caller", () => {
        const nodes = [node("source")];
        const source = createWorkbenchDocument({ id: "doc", title: "  草稿  ", revision: 3.9, viewport: { x: Number.NaN, y: 5, k: 30 }, nodes });
        expect(source).toMatchObject({ title: "草稿", revision: 3, viewport: { x: 0, y: 5, k: 4 } });
        expect(source.nodes).not.toBe(nodes);
        expect(source.nodes[0].metadata).not.toBe(nodes[0].metadata);
        nodes[0].metadata!.content = "changed by caller";
        expect(source.nodes[0].metadata?.content).toBe("content:source");
        const restored = createWorkbenchDocument(JSON.parse(JSON.stringify(source)));
        expect(restored).toEqual(source);
        expect(createWorkbenchDocument({ id: "empty", title: " ", revision: -5 }).title).toBe("未命名创作");
        expect(createWorkbenchDocument({ id: "empty", revision: -5 }).revision).toBe(0);
    });

    it("bounds zoom and fills invalid viewport scalars without mutating the input", () => {
        const input = { x: Infinity, y: -4, k: -8 };
        expect(normalizeViewport(input)).toEqual({ x: 0, y: -4, k: 0.05 });
        expect(input).toEqual({ x: Infinity, y: -4, k: -8 });
        expect(normalizeViewport()).toEqual({ x: 0, y: 0, k: 1 });
        expect(normalizeViewport({ k: Number.NaN })).toEqual({ x: 0, y: 0, k: 1 });
    });

    it("reports malformed imported structures instead of throwing a property access error", () => {
        const malformed = { id: "", nodes: [null, { id: "node", position: null, width: 0, height: -1 }], connections: [null] } as unknown as WorkbenchDocument;
        expect(validateWorkbenchDocument(malformed)).toEqual([
            { path: "id", message: "文档标识不能为空" },
            { path: "nodes.0", message: "节点格式无效" },
            { path: "nodes.1.position", message: "节点位置必须是有限数字" },
            { path: "nodes.1", message: "节点尺寸必须是正数" },
            { path: "connections.0", message: "连接格式无效" },
        ]);
        expect(validateWorkbenchDocument(null as unknown as WorkbenchDocument)).toEqual([{ path: "", message: "画布文档格式无效" }]);
        expect(validateWorkbenchDocument({ id: "doc", nodes: null, connections: null } as unknown as WorkbenchDocument).map(({ path }) => path)).toEqual(["nodes", "connections"]);
    });

    it("rejects duplicate identities, dangling endpoints, self edges, and repeated directed edges", () => {
        const invalid = { ...document(), nodes: [node("a"), node("a"), node("b")], connections: [
            connection("same", "a", "b"), connection("same", "a", "b"), connection("self", "a", "a"), connection("dangling", "missing", "b"),
        ] };
        const messages = validateWorkbenchDocument(invalid).map(({ message }) => message);
        expect(messages).toContain("节点标识重复");
        expect(messages).toContain("连接标识为空或重复");
        expect(messages).toContain("相同方向的连接只能保留一条");
        expect(messages).toContain("节点不能连接到自身");
        expect(messages).toContain("连接引用了不存在的节点");
        expect(() => createWorkbenchDocument(invalid)).toThrow("节点标识重复");
    });

    it("uses immutable command updates and clones caller-owned added nodes and patches", () => {
        const initial = document();
        const renamed = reduceWorkbenchDocument(initial, { type: "rename", title: "  定稿  " });
        expect(renamed.title).toBe("定稿");
        expect(renamed.revision).toBe(1);
        expect(renamed.nodes).toBe(initial.nodes);
        expect(renamed.connections).toBe(initial.connections);
        expect(initial.title).toBe("未命名创作");
        const added = node("d");
        const withNode = reduceWorkbenchDocument(renamed, { type: "add-node", node: added });
        added.position.x = 999;
        expect(withNode.nodes[3].position.x).toBe(0);
        expect(withNode.nodes[0]).toBe(renamed.nodes[0]);
        const patch = { id: "cannot-change-id", position: { x: 40, y: 50 }, metadata: { content: "updated" } };
        const patched = reduceWorkbenchDocument(withNode, { type: "patch-node", nodeId: "b", patch });
        patch.metadata.content = "changed later";
        expect(patched.nodes[1]).toMatchObject({ id: "b", position: { x: 40, y: 50 }, metadata: { content: "updated" } });
        expect(withNode.nodes[1].metadata?.content).toBe("content:b");
        expect(patched.nodes[0]).toBe(withNode.nodes[0]);
    });

    it("keeps connection addition idempotent, validates failures atomically, and cascades node deletion", () => {
        const initial = document();
        const connected = reduceWorkbenchDocument(initial, { type: "connect", connection: connection("a-b", "a", "b") });
        const both = reduceWorkbenchDocument(connected, { type: "connect", connection: connection("b-c", "b", "c") });
        expect(reduceWorkbenchDocument(both, { type: "connect", connection: connection("another", "a", "b") })).toBe(both);
        expect(() => reduceWorkbenchDocument(both, { type: "connect", connection: connection("bad", "a", "missing") })).toThrow("连接引用了不存在的节点");
        expect(() => reduceWorkbenchDocument(both, { type: "connect", connection: connection("bad", "a", "a") })).toThrow("节点不能连接到自身");
        expect(() => reduceWorkbenchDocument(both, { type: "patch-node", nodeId: "b", patch: { width: 0 } })).toThrow("节点尺寸必须是正数");
        expect(both.nodes[1].width).toBe(320);
        expect(both.connections).toHaveLength(2);
        const removed = reduceWorkbenchDocument(both, { type: "remove-nodes", nodeIds: ["b"] });
        expect(removed.nodes.map(({ id }) => id)).toEqual(["a", "c"]);
        expect(removed.connections).toEqual([]);
        expect(removed.revision).toBe(3);
        expect(both.connections).toHaveLength(2);
    });

    it("preserves command revision rules, unknown-node errors, and standalone connection deletion", () => {
        const initial = document();
        expect(reduceWorkbenchDocument(initial, { type: "rename", title: " " })).toMatchObject({ title: initial.title, revision: 1 });
        const moved = reduceWorkbenchDocument(initial, { type: "viewport", viewport: { x: 100, k: 0.001 } });
        expect(moved.viewport).toEqual({ x: 100, y: 0, k: 0.05 });
        expect(initial.viewport).toEqual({ x: 0, y: 0, k: 1 });
        expect(() => reduceWorkbenchDocument(initial, { type: "add-node", node: node("a") })).toThrow("节点标识已存在");
        expect(() => reduceWorkbenchDocument(initial, { type: "patch-node", nodeId: "unknown", patch: { title: "none" } })).toThrow("节点不存在");
        const connected = reduceWorkbenchDocument(initial, { type: "connect", connection: connection("a-b", "a", "b") });
        const without = reduceWorkbenchDocument(connected, { type: "remove-connections", connectionIds: ["a-b"] });
        expect(without.connections).toEqual([]);
        expect(without.nodes).toBe(connected.nodes);
        expect(without.revision).toBe(2);
        expect(nodeCenter(node("center", 10))).toEqual({ x: 170, y: 110 });
    });
});
