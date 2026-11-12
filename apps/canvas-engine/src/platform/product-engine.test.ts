import { describe, expect, it } from "vitest";
import {
  applyProductCommand,
  createProductDocument,
  validateProductDocument,
  type ProductNode,
} from "@/product-engine/document";
import {
  connectionCurve,
  edgeCurve,
  findNodeAt,
  panBy,
  previewEdgeCurve,
  screenToWorld,
  unionBounds,
  worldToScreen,
  zoomAt,
} from "@/product-engine/geometry";
import {
  commitDocument,
  createDocumentHistory,
  redoDocument,
  undoDocument,
} from "@/product-engine/history";
import { fromStoredCanvas, toStoredCanvas } from "@/product-engine/compat";
import { createCanvasProject } from "@/lib/canvas/canvas-project-catalog";
import {
  canvasHistoryProjectPatch,
  createCanvasHistoryEntry,
} from "@/pages/canvas/hooks/use-canvas-history";

const node = (id: string, x: number, y: number): ProductNode => ({
  id,
  kind: "text",
  title: id,
  frame: { x, y, width: 120, height: 80 },
  data: {},
});

describe("independent canvas document kernel", () => {
  it("routes history snapshots through the product document and excludes engine fields from persistence", () => {
    const project = createCanvasProject("history", "History", "created");
    const payload = {
      nodes: [
        {
          id: "script",
          type: "text",
          title: "Script",
          position: { x: 24, y: 32 },
          width: 420,
          height: 260,
          metadata: { content: "storyboard draft" },
        },
      ],
      connections: [],
      chatSessions: [
        {
          id: "session",
          title: "Session",
          messages: [],
          createdAt: "created",
          updatedAt: "updated",
        },
      ],
      activeChatId: "session",
      backgroundMode: "dots" as const,
      showImageInfo: true,
    };

    const entry = createCanvasHistoryEntry(project, payload);
    const storedPatch = canvasHistoryProjectPatch(entry);

    expect(entry.document.nodes[0]).toMatchObject({
      id: "script",
      kind: "text",
      data: { content: "storyboard draft" },
    });
    expect(storedPatch).toEqual(payload);
    expect(storedPatch).not.toHaveProperty("document");
    expect(storedPatch).not.toHaveProperty("base");
    expect(entry.document.viewport).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it("rejects unsafe coordinates and duplicate operations before persisting", () => {
    const base = createProductDocument("p1", "Board");
    expect(() => createProductDocument("p2", "x".repeat(257))).toThrow(
      "画布名称无效",
    );
    expect(() =>
      applyProductCommand(base, {
        type: "node.add",
        node: {
          ...node("far", 0, 0),
          frame: { ...node("far", 0, 0).frame, x: 10_000_001 },
        },
      }),
    ).toThrow("尺寸或位置无效");

    const withNode = applyProductCommand(base, {
      type: "node.add",
      node: node("a", 0, 0),
    });
    expect(() =>
      applyProductCommand(withNode, {
        type: "node.move",
        positions: [
          { id: "a", x: 1, y: 2 },
          { id: "a", x: 3, y: 4 },
        ],
      }),
    ).toThrow("重复节点");
    expect(() =>
      applyProductCommand(withNode, {
        type: "viewport.set",
        viewport: { x: 0, y: 0, scale: Number.NaN },
      }),
    ).toThrow("视口无效");
    expect(withNode.nodes[0].frame).toEqual(node("a", 0, 0).frame);
  });

  it("rejects invalid endpoints while preserving intentional cyclic workflows", () => {
    const base = createProductDocument("p1", "Board");
    const withNodes = applyProductCommand(base, {
      type: "node.add",
      node: node("a", 0, 0),
    });
    const next = applyProductCommand(withNodes, {
      type: "node.add",
      node: node("b", 200, 0),
    });
    const linked = applyProductCommand(next, {
      type: "edge.connect",
      edge: { id: "ab", from: "a", to: "b" },
    });
    expect(validateProductDocument(linked)).toEqual([]);
    const cyclic = applyProductCommand(linked, {
      type: "edge.connect",
      edge: { id: "ba", from: "b", to: "a" },
    });
    expect(validateProductDocument(cyclic)).toEqual([]);
    expect(cyclic.edges.map(({ from, to }) => [from, to])).toEqual([
      ["a", "b"],
      ["b", "a"],
    ]);
    expect(() =>
      applyProductCommand(base, {
        type: "edge.connect",
        edge: { id: "missing", from: "a", to: "b" },
      }),
    ).toThrow("无效连线");
    expect(() =>
      applyProductCommand(linked, {
        type: "edge.connect",
        edge: { id: "duplicate", from: "a", to: "b" },
      }),
    ).toThrow("重复");
  });

  it("applies multi-node edits immutably and removes incident edges", () => {
    const document = [
      node("a", 0, 0),
      node("b", 160, 0),
      node("c", 320, 0),
    ].reduce(
      (current, item) =>
        applyProductCommand(current, { type: "node.add", node: item }),
      createProductDocument("p", "Board"),
    );
    const linked = applyProductCommand(document, {
      type: "edge.connect",
      edge: { id: "ab", from: "a", to: "b" },
    });
    const moved = applyProductCommand(linked, {
      type: "node.move",
      positions: [
        { id: "a", x: 10, y: 20 },
        { id: "b", x: 210, y: 20 },
      ],
    });
    const removed = applyProductCommand(moved, {
      type: "node.remove",
      ids: ["a"],
    });
    expect(moved.nodes[0].frame).toEqual({
      x: 10,
      y: 20,
      width: 120,
      height: 80,
    });
    expect(linked.nodes[0].frame.x).toBe(0);
    expect(removed.nodes.map(({ id }) => id)).toEqual(["b", "c"]);
    expect(removed.edges).toEqual([]);
  });

  it("round-trips persisted node metadata, connections, and project preferences", () => {
    const base = createCanvasProject(
      "persisted",
      "已保存的项目",
      "2026-11-12T00:00:00.000Z",
    );
    const withNode = applyProductCommand(fromStoredCanvas(base), {
      type: "node.add",
      node: {
        ...node("script", 16, 24),
        kind: "text",
        data: { prompt: "延续角色设定", skillId: "storyboard" },
      },
    });
    const withEdge = applyProductCommand(withNode, {
      type: "node.add",
      node: node("shot", 240, 24),
    });
    const linked = applyProductCommand(withEdge, {
      type: "edge.connect",
      edge: { id: "script-shot", from: "script", to: "shot" },
    });
    const saved = toStoredCanvas(
      { ...base, backgroundMode: "dots", showImageInfo: true },
      {
        ...linked,
        chatSessions: [{ id: "chat-1", messages: [] }],
        activeChatId: "chat-1",
        backgroundMode: "dots",
        showImageInfo: true,
      },
    );
    const restored = fromStoredCanvas(saved);
    expect(restored.nodes[0].data).toEqual({
      prompt: "延续角色设定",
      skillId: "storyboard",
    });
    expect(restored.edges).toEqual([
      { id: "script-shot", from: "script", to: "shot" },
    ]);
    expect(saved.backgroundMode).toBe("dots");
    expect(saved.showImageInfo).toBe(true);
    expect(restored.chatSessions).toEqual([{ id: "chat-1", messages: [] }]);
    expect(restored.activeChatId).toBe("chat-1");
    expect(restored.backgroundMode).toBe("dots");
    expect(restored.viewport).toEqual({ x: 0, y: 0, scale: 1 });
  });
});

describe("canvas coordinate and history policies", () => {
  it("round-trips coordinates and zooms around the pointer anchor", () => {
    const viewport = { x: 24, y: -12, scale: 1.5 };
    const point = { x: 300, y: 140 };
    expect(screenToWorld(worldToScreen(point, viewport), viewport)).toEqual(
      point,
    );
    const zoomed = zoomAt(viewport, { x: 200, y: 100 }, 2);
    expect(
      worldToScreen(screenToWorld({ x: 200, y: 100 }, viewport), zoomed),
    ).toEqual({ x: 200, y: 100 });
    expect(panBy(viewport, { x: 12, y: -6 })).toEqual({
      x: 36,
      y: -18,
      scale: 1.5,
    });
    expect(zoomAt({ x: 0, y: 0, scale: 1 }, { x: 0, y: 0 }, 0.001).scale).toBe(
      0.05,
    );
    expect(zoomAt({ x: 0, y: 0, scale: 5 }, { x: 0, y: 0 }, 100).scale).toBe(5);
  });

  it("uses visual stacking order for hit tests and computes stable graph geometry", () => {
    const back = node("back", 0, 0);
    const front = node("front", 20, 10);
    expect(findNodeAt({ x: 30, y: 20 }, [back, front])?.id).toBe("front");
    expect(unionBounds([back.frame, front.frame])).toEqual({
      x: 0,
      y: 0,
      width: 140,
      height: 90,
    });
    expect(connectionCurve({ x: 10, y: 20 }, { x: 210, y: 120 })).toMatch(
      /^M 10 20 C /,
    );
    expect(edgeCurve(back, front).start).toEqual({ x: 120, y: 40 });
    expect(edgeCurve(back, front).end).toEqual({ x: 20, y: 50 });
    expect(previewEdgeCurve(back, "source", { x: 200, y: 80 }).path).toMatch(
      /^M 120 40 L 200 80$/,
    );
  });

  it("bounds history, supports undo/redo, and discards redo after a new edit", () => {
    let history = createDocumentHistory("a", 2);
    history = commitDocument(history, "b");
    history = commitDocument(history, "c");
    history = commitDocument(history, "d");
    expect(history.past).toEqual(["b", "c"]);
    history = undoDocument(history);
    expect(history.present).toBe("c");
    history = redoDocument(history);
    expect(history.present).toBe("d");
    history = undoDocument(history);
    history = commitDocument(history, "edited");
    expect(history.future).toEqual([]);
  });
});
