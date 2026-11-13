import { describe, expect, it, vi } from "vitest";
import { StudioSession, fitStudioView, makeStudioNode, normalizeStudioDocument, type StudioDocument } from "@/atlas-engine/studio/studio-document";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const node = (id: string, x = 0, y = 0, metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData => ({ id, type: CanvasNodeType.Text, title: id, position: { x, y }, width: 320, height: 200, metadata });
const document = (nodes: CanvasNodeData[] = [node("a"), node("b", 500, 200)], patch: Partial<StudioDocument> = {}): StudioDocument => ({ nodes, connections: [], viewport: { x: 0, y: 0, k: 1 }, backgroundMode: "dots", showImageInfo: false, ...patch });

describe("independent studio document journal", () => {
  it("moves and resizes nodes without reading connections or replacing selection and untouched nodes", () => {
    const readEdge = vi.fn();
    const connection = new Proxy({ id: "ab", fromNodeId: "a", toNodeId: "b" }, {
      get(target, property, receiver) {
        readEdge(property);
        return Reflect.get(target, property, receiver);
      },
    });
    const session = new StudioSession(document(undefined, { connections: [connection] }));
    session.select(["a"], "ab");
    const before = session.snapshot();
    readEdge.mockClear();
    session.beginGesture(["a"]);
    for (let frame = 1; frame <= 60; frame++) {
      session.changeGeometry(item => item.id === "a"
        ? { position: { x: frame, y: frame * 2 }, width: 320 + frame }
        : undefined);
    }
    session.endGesture();
    expect(readEdge).not.toHaveBeenCalled();
    expect(session.read().connections).toBe(before.document.connections);
    expect(session.read().viewport).toBe(before.document.viewport);
    expect(session.read().nodes[1]).toBe(before.document.nodes[1]);
    expect(session.read().nodes[0].metadata).toBe(before.document.nodes[0].metadata);
    expect(session.snapshot().selection).toBe(before.selection);
    expect(session.snapshot().edge).toBe("ab");
    expect(session.read().nodes[0]).toMatchObject({ position: { x: 60, y: 120 }, width: 380 });
    session.undo();
    expect(session.read().nodes[0]).toMatchObject({ position: { x: 0, y: 0 }, width: 320 });
    expect(session.snapshot().undo).toBe(false);
    session.redo();
    expect(session.read().nodes[0]).toMatchObject({ position: { x: 60, y: 120 }, width: 380 });
  });

  it("normalizes geometry patches while ignoring topology fields, then skips unchanged frames", () => {
    const session = new StudioSession(document());
    session.changeGeometry(item => item.id === "a" ? {
      id: "cannot-replace-node",
      title: "cannot-replace-content",
      width: -20,
      height: Infinity,
      position: { x: NaN, y: Infinity },
    } : undefined);
    expect(session.read().nodes[0]).toMatchObject({ id: "a", title: "a", width: 80, height: 210, position: { x: 0, y: 0 } });
    const before = session.snapshot();
    const listener = vi.fn(); session.subscribe(listener);
    session.changeGeometry(item => item.id === "a"
      ? { width: -20, height: Infinity, position: { x: NaN, y: Infinity } }
      : undefined);
    session.changeGeometry(() => undefined);
    expect(session.snapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    session.dispose();
    session.changeGeometry(() => ({ width: 1000 }));
    expect(session.snapshot()).toBe(before);
  });

  it("uses the latest nodes and media results during a geometry gesture, including structural edits", () => {
    const session = new StudioSession(document());
    session.beginGesture(["a", "b"]);
    session.changeGeometry(item => ({ position: { x: item.position.x + 20, y: item.position.y + 10 } }));
    session.metadata("a", { content: "completed-media", status: "success" }, false);
    session.remove(new Set(["b"]));
    session.insert([node("completed", 900, 400)]);
    session.changeGeometry(item => item.id === "a" || item.id === "b"
      ? { position: { x: 80, y: 50 } }
      : undefined);
    session.endGesture();
    session.undo();
    expect(session.read().nodes.map(item => item.id)).toEqual(["a", "completed"]);
    expect(session.read().nodes[0]).toMatchObject({ position: { x: 0, y: 0 }, metadata: { content: "completed-media", status: "success" } });
    expect(session.read().nodes[1].position).toEqual({ x: 900, y: 400 });
    session.redo();
    expect(session.read().nodes[0].position).toEqual({ x: 80, y: 50 });
  });

  it("camera frames preserve graph and selection identity, do not touch history, and reject non-finite geometry", () => {
    const session = new StudioSession(document());
    session.select(["a"]);
    const before = session.snapshot();
    for (let i = 0; i < 50; i++) session.moveViewport({ x: i, y: -i, k: 1 + i / 100 });
    expect(session.read().nodes).toBe(before.document.nodes);
    expect(session.read().connections).toBe(before.document.connections);
    expect(session.snapshot().selection).toBe(before.selection);
    expect(session.snapshot().undo).toBe(false);
    session.moveViewport({ x: NaN, y: Infinity, k: 999 });
    expect(session.read().viewport).toEqual({ x: 0, y: 0, k: 3 });
    session.select(["missing", "a"]); expect([...session.snapshot().selection]).toEqual(["a"]);
  });
  it("undoes a drag while retaining a completed asynchronous result", () => {
    const session = new StudioSession(document());
    session.beginGesture(["a"]);
    session.patch("a", { position: { x: 120, y: 80 } });
    session.insert([node("completed", 900, 400, { content: "generated-result", status: "success" })]);
    session.metadata("a", { prompt: "newer independent input" }, false);
    session.endGesture(); session.undo();
    expect(session.read().nodes[0].position).toEqual({ x: 0, y: 0 });
    expect(session.read().nodes[0].metadata?.prompt).toBe("newer independent input");
    expect(session.read().nodes.find(item => item.id === "completed")?.metadata?.content).toBe("generated-result");
    session.redo(); expect(session.read().nodes[0].position).toEqual({ x: 120, y: 80 });
  });
  it("normalizes invalid geometry, duplicate ids and unusable edges at the document boundary", () => {
    const input = document([node("a", Number.NaN, Infinity), { ...node("b"), width: -4, height: Number.NaN }, node("a")], {
      viewport: { x: Number.NaN, y: Infinity, k: 900 },
      connections: [
        { id: "ab", fromNodeId: "a", toNodeId: "b" },
        { id: "ab2", fromNodeId: "a", toNodeId: "b" },
        { id: "self", fromNodeId: "a", toNodeId: "a" },
        { id: "missing", fromNodeId: "a", toNodeId: "missing" },
      ],
    });
    const result = normalizeStudioDocument(input);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0].position).toEqual({ x: 0, y: 0 });
    expect(result.nodes[1]).toMatchObject({ width: 80, height: 210 });
    expect(result.connections).toEqual([{ id: "ab", fromNodeId: "a", toNodeId: "b" }]);
    expect(result.viewport).toEqual({ x: 0, y: 0, k: 3 });
    expect(input.nodes).toHaveLength(3);
  });

  it("keeps selection changes out of document undo and redo", () => {
    const session = new StudioSession(document());
    session.select(["a"]); session.patch("a", { title: "edited" }); session.select(["b"]);
    session.undo();
    expect(session.read().nodes[0].title).toBe("a");
    expect([...session.snapshot().selection]).toEqual(["b"]);
    session.redo(); expect(session.read().nodes[0].title).toBe("edited");
  });

  it("commits a complete drag gesture as one undo step and invalidates redo on new edits", () => {
    const session = new StudioSession(document());
    session.beginGesture();
    for (let index = 1; index <= 12; index++) session.patch("a", { position: { x: index * 10, y: index * 5 } });
    session.endGesture();
    session.undo(); expect(session.read().nodes[0].position).toEqual({ x: 0, y: 0 });
    expect(session.snapshot().undo).toBe(false);
    session.patch("b", { title: "new branch" }); expect(session.snapshot().redo).toBe(false);
    session.redo(); expect(session.read().nodes[0].position).toEqual({ x: 0, y: 0 });
  });

  it("refuses self edges, duplicates, absent nodes and cycles", () => {
    const session = new StudioSession(document([node("a"), node("b"), node("c")]));
    expect(session.connect("a", "a")).toBe(false);
    expect(session.connect("a", "absent")).toBe(false);
    expect(session.connect("a", "b")).toBe(true);
    expect(session.connect("a", "b")).toBe(false);
    expect(session.connect("b", "c")).toBe(true);
    expect(session.connect("c", "a")).toBe(false);
    expect(session.read().connections).toHaveLength(2);
  });

  it("clones a group, its contained nodes, internal edges and reference tokens with fresh ids", () => {
    const group = { ...node("group", 30, 40), type: CanvasNodeType.Group };
    const child = node("child", 70, 100, { groupId: "group", content: "data", status: "loading", videoTaskId: "do-not-resume", composerContent: "@[node:other] @[node:external]" });
    const other = node("other", 500, 100, { groupId: "group", prompt: "@[node:child]" });
    const session = new StudioSession(document([group, child, other, node("external")], { connections: [{ id: "internal", fromNodeId: "child", toNodeId: "other" }, { id: "external-edge", fromNodeId: "external", toNodeId: "child" }] }));
    session.select(["group"]); session.clone();
    const clones = session.read().nodes.slice(4); expect(clones).toHaveLength(3);
    const copiedGroup = clones.find(item => item.type === CanvasNodeType.Group)!;
    const copiedChild = clones.find(item => item.title === "child")!;
    const copiedOther = clones.find(item => item.title === "other")!;
    expect(copiedChild.metadata).toMatchObject({ groupId: copiedGroup.id, status: "idle", composerContent: `@[node:${copiedOther.id}] @[node:external]` });
    expect(copiedChild.metadata?.videoTaskId).toBeUndefined();
    expect(copiedOther.metadata?.prompt).toBe(`@[node:${copiedChild.id}]`);
    expect(copiedChild.position).toEqual({ x: 118, y: 148 });
    expect(session.read().connections.slice(2)).toMatchObject([{ fromNodeId: copiedChild.id, toNodeId: copiedOther.id }]);
    expect([...session.snapshot().selection]).toHaveLength(3);
    session.undo(); expect(session.read().nodes).toHaveLength(4);
  });

  it("groups selected content, keeps children aligned during tidy and ungroups without removing content", () => {
    const session = new StudioSession(document([node("a", 200, 200), node("b", 700, 350), node("outside", 1800, 1200)]));
    session.select(["a", "b"]); session.group("sequence");
    const group = session.read().nodes.find(item => item.type === CanvasNodeType.Group)!;
    expect(group).toBeDefined();
    const before = session.read().nodes.find(item => item.id === "a")!;
    const offset = { x: before.position.x - group.position.x, y: before.position.y - group.position.y };
    session.select([]); session.tidy();
    const movedGroup = session.read().nodes.find(item => item.id === group.id)!;
    const movedChild = session.read().nodes.find(item => item.id === "a")!;
    expect({ x: movedChild.position.x - movedGroup.position.x, y: movedChild.position.y - movedGroup.position.y }).toEqual(offset);
    session.select([group.id]); session.ungroup();
    expect(session.read().nodes).toHaveLength(3);
    expect(session.read().nodes.every(item => !item.metadata?.groupId)).toBe(true);
  });

  it("removes dangling connections and group memberships while retaining undo data", () => {
    const group = { ...node("group"), type: CanvasNodeType.Group };
    const session = new StudioSession(document([group, node("a", 50, 50, { groupId: "group" }), node("b")], { connections: [{ id: "ab", fromNodeId: "a", toNodeId: "b" }] }));
    session.remove(new Set(["group"]));
    expect(session.read().nodes.find(item => item.id === "a")?.metadata?.groupId).toBeUndefined();
    session.remove(new Set(["a"])); expect(session.read().connections).toHaveLength(0);
    session.undo(); expect(session.read().connections).toHaveLength(1);
  });

  it("notifies subscribers and prevents mutations after disposal", () => {
    const session = new StudioSession(document()); const listener = vi.fn(); const unsubscribe = session.subscribe(listener);
    session.patch("a", { title: "first" }); expect(listener).toHaveBeenCalledOnce();
    unsubscribe(); session.patch("a", { title: "second" }); expect(listener).toHaveBeenCalledOnce();
    const before = session.read(); session.dispose(); session.patch("a", { title: "discarded" }); session.insert([node("c")]);
    expect(session.alive()).toBe(false); expect(session.read()).toBe(before);
  });

  it("returns a complete view transform that centers and fits a nonempty document", () => {
    const nodes = [node("a", -300, -200), node("b", 700, 600)];
    const view = fitStudioView(nodes, 1400, 1000);
    expect(view.k).toBeGreaterThanOrEqual(.12); expect(view.k).toBeLessThanOrEqual(1.2);
    for (const item of nodes) {
      expect(item.position.x * view.k + view.x).toBeGreaterThanOrEqual(0);
      expect(item.position.y * view.k + view.y).toBeGreaterThanOrEqual(0);
      expect((item.position.x + item.width) * view.k + view.x).toBeLessThanOrEqual(1400);
      expect((item.position.y + item.height) * view.k + view.y).toBeLessThanOrEqual(1000);
    }
    expect(fitStudioView([], 1400, 1000)).toEqual({ x: 540, y: 400, k: 1 });
  });

  it("creates reusable nodes with independent ids and explicit initial status", () => {
    const a = makeStudioNode("text", 12, 20, "note"); const b = makeStudioNode("text", 12, 20, "note", { content: "retained", status: "success" });
    expect(a.id).not.toBe(b.id); expect(a.metadata?.status).toBe("idle");
    expect(b.metadata).toMatchObject({ content: "retained", status: "success" });
  });
});
