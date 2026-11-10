import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  captureCanvasHotState,
  displaySize,
  emptyDocument,
  readDocument,
  restoreCanvasHotState,
  serializeDocument,
  useCanvas,
} from "./store";

describe("canvas state and safe import", () => {
  beforeEach(() => useCanvas.getState().load(emptyDocument()));
  it("undoes an asset node and restores its dependency edge", () => {
    const a = useCanvas.getState().add("image");
    const b = useCanvas.getState().add("video");
    useCanvas
      .getState()
      .connect({
        source: a,
        target: b,
        sourceHandle: null,
        targetHandle: null,
      });
    useCanvas.getState().remove(a);
    expect(serializeDocument().edges).toHaveLength(0);
    useCanvas.getState().undo();
    expect(serializeDocument().nodes).toHaveLength(2);
    expect(serializeDocument().edges[0].source).toBe(a);
  });
  it("connects dependency ports and preserves the connection through serialization", () => {
    const source = useCanvas.getState().add("note", { prompt: "水循环包括蒸发与降水。" });
    const target = useCanvas.getState().add("image");
    expect(useCanvas.getState().connect({ source, target, sourceHandle: "output", targetHandle: "input" })).toBe(true);
    const document = serializeDocument();
    expect(document.edges).toHaveLength(1);
    expect(document.edges[0]).toMatchObject({ source, target, sourceHandle: "output", targetHandle: "input" });
    expect(readDocument(JSON.parse(JSON.stringify(document)))).toEqual(document);
  });
  it("rejects self, missing and duplicate connections without changing history or dirty state", () => {
    const source = useCanvas.getState().add("image");
    const target = useCanvas.getState().add("video");
    expect(useCanvas.getState().connect({ source, target, sourceHandle: null, targetHandle: null })).toBe(true);
    const before = useCanvas.getState();
    for (const connection of [
      { source, target: source },
      { source: "missing", target },
      { source, target: "missing" },
      { source, target },
    ]) expect(useCanvas.getState().connect({ ...connection, sourceHandle: "output", targetHandle: "input" })).toBe(false);
    expect(useCanvas.getState().document).toBe(before.document);
    expect(useCanvas.getState().history).toBe(before.history);
    expect(useCanvas.getState().editVersion).toBe(before.editVersion);
  });
  it("rejects cycles across visible edges and legacy skill dependencies", () => {
    const one = useCanvas.getState().add("note");
    const two = useCanvas.getState().add("image", { sourceNodeIds: [one] });
    const three = useCanvas.getState().add("video");
    expect(useCanvas.getState().connect({ source: two, target: three, sourceHandle: null, targetHandle: null })).toBe(true);
    expect(useCanvas.getState().connect({ source: three, target: one, sourceHandle: null, targetHandle: null })).toBe(false);
    expect(serializeDocument().edges).toHaveLength(1);
  });
  it("disconnects visible and matching legacy dependencies as one undoable edit", () => {
    const source = useCanvas.getState().add("image");
    const target = useCanvas.getState().add("video", { sourceNodeIds: [source] });
    useCanvas.getState().connect({ source, target, sourceHandle: null, targetHandle: null });
    const edge = serializeDocument().edges[0];
    useCanvas.getState().edgeChanges([{ type: "remove", id: edge.id }]);
    expect(serializeDocument().edges).toHaveLength(0);
    expect(serializeDocument().nodes.find((node) => node.id === target)?.data.sourceNodeIds).toEqual([]);
    useCanvas.getState().undo();
    expect(serializeDocument().edges).toEqual([edge]);
    expect(serializeDocument().nodes.find((node) => node.id === target)?.data.sourceNodeIds).toEqual([source]);
    useCanvas.getState().redo();
    expect(serializeDocument().edges).toHaveLength(0);
    expect(serializeDocument().nodes.find((node) => node.id === target)?.data.sourceNodeIds).toEqual([]);
  });
  it("cleans both kinds of dependencies when deleting nodes through the legacy adapter", () => {
    const source = useCanvas.getState().add("image");
    const target = useCanvas.getState().add("video", { sourceNodeIds: [source] });
    useCanvas.getState().connect({ source, target, sourceHandle: null, targetHandle: null });
    useCanvas.getState().changes([{ type: "remove", id: source }]);
    expect(serializeDocument().nodes).toHaveLength(1);
    expect(serializeDocument().edges).toEqual([]);
    expect(serializeDocument().nodes[0].data.sourceNodeIds).toEqual([]);
    useCanvas.getState().undo();
    expect(serializeDocument().nodes).toHaveLength(2);
    expect(serializeDocument().edges).toHaveLength(1);
    expect(serializeDocument().nodes.find((node) => node.id === target)?.data.sourceNodeIds).toEqual([source]);
  });
  it("rejects dangling and cyclic dependency imports while allowing redundant legacy metadata", () => {
    const source = useCanvas.getState().add("image");
    const target = useCanvas.getState().add("video", { sourceNodeIds: [source] });
    useCanvas.getState().connect({ source, target, sourceHandle: null, targetHandle: null });
    const document = serializeDocument();
    expect(() => readDocument(document)).not.toThrow();
    const badSource = (sourceNodeIds: string[]) => ({ ...document, nodes: document.nodes.map((node) =>
      node.id === source ? { ...node, data: { ...node.data, sourceNodeIds } } : node) });
    expect(() => readDocument(badSource(["missing"]))).toThrow("无效引用");
    expect(() => readDocument(badSource([source]))).toThrow("无效引用");
    expect(() => readDocument(badSource([target]))).toThrow("循环引用");
    expect(() => readDocument({ ...document, edges: [...document.edges, { id: "duplicate", source, target }] })).toThrow("无效");
  });
  it("keeps changes made during a save dirty", () => {
    const id = useCanvas.getState().add("image");
    const submittedVersion = useCanvas.getState().editVersion;
    useCanvas.getState().patch(id, { prompt: "newer edit" });
    useCanvas.getState().markSaved(submittedVersion);
    expect(useCanvas.getState().editVersion).toBeGreaterThan(
      useCanvas.getState().savedVersion,
    );
  });
  it("treats a multi-pointer drag as one undoable edit", () => {
    const id = useCanvas.getState().add("image", {}, { x: 10, y: 20 });
    const startVersion = useCanvas.getState().editVersion;
    useCanvas.getState().beginGesture();
    useCanvas.getState().moveSelected(80, 45);
    useCanvas.getState().moveSelected(120, 90);
    useCanvas.getState().endGesture();
    expect(useCanvas.getState().document.nodes[0].position).toEqual({ x: 130, y: 110 });
    expect(useCanvas.getState().history).toHaveLength(2);
    expect(useCanvas.getState().editVersion).toBe(startVersion + 1);
    useCanvas.getState().undo();
    expect(useCanvas.getState().document.nodes.find((node) => node.id === id)?.position).toEqual({ x: 10, y: 20 });
    useCanvas.getState().redo();
    expect(useCanvas.getState().document.nodes.find((node) => node.id === id)?.position).toEqual({ x: 130, y: 110 });
  });
  it("does not put viewport motion in undo history but persists it", () => {
    useCanvas.getState().add("image", {}, { x: 0, y: 0 });
    const beforeHistory = useCanvas.getState().history.length;
    const beforeVersion = useCanvas.getState().editVersion;
    useCanvas.getState().setViewport({ x: -140, y: 75, zoom: 1.25 });
    expect(serializeDocument().viewport).toEqual({ x: -140, y: 75, zoom: 1.25 });
    expect(useCanvas.getState().history).toHaveLength(beforeHistory);
    expect(useCanvas.getState().editVersion).toBe(beforeVersion + 1);
    useCanvas.getState().undo();
    expect(useCanvas.getState().document.nodes).toHaveLength(0);
    expect(serializeDocument().viewport).toEqual({ x: -140, y: 75, zoom: 1.25 });
  });
  it("merges consecutive text changes into a single undo step", () => {
    const id = useCanvas.getState().add("note", { prompt: "" });
    const historyAfterAdd = useCanvas.getState().history.length;
    for (const prompt of ["新", "新的", "新的想", "新的想法"]) useCanvas.getState().patch(id, { prompt });
    expect(useCanvas.getState().history).toHaveLength(historyAfterAdd + 1);
    useCanvas.getState().undo();
    expect(useCanvas.getState().document.nodes.find((node) => node.id === id)?.data.prompt).toBe("");
  });
  it("selects, duplicates and deletes a set of objects as undoable commands", () => {
    const one = useCanvas.getState().add("image", {}, { x: 0, y: 0 });
    const two = useCanvas.getState().add("note", {}, { x: 200, y: 30 });
    useCanvas.getState().select([one, two]);
    useCanvas.getState().duplicateSelected();
    expect(useCanvas.getState().document.nodes).toHaveLength(4);
    expect(useCanvas.getState().document.nodes.filter((node) => node.selected)).toHaveLength(2);
    useCanvas.getState().deleteSelected();
    expect(useCanvas.getState().document.nodes).toHaveLength(2);
    useCanvas.getState().undo();
    expect(useCanvas.getState().document.nodes).toHaveLength(4);
  });
  it("rejects imported external media URLs", () => {
    const id = useCanvas
      .getState()
      .add("image", { url: "https://untrusted.example/asset" });
    expect(id).toBeTruthy();
    expect(() => readDocument(serializeDocument())).toThrow("本平台素材");
  });
  it("loads the schema 1 shape with legacy edges and no display metadata", () => {
    const document = {
      schemaVersion: 1 as const,
      nodes: [
        { id: "old-image", type: "creative" as const, position: { x: 40, y: 80 }, data: { kind: "image" as const, title: "旧图片", prompt: "" } },
        { id: "old-video", type: "creative" as const, position: { x: 360, y: 80 }, data: { kind: "video" as const, title: "旧视频", prompt: "" } },
      ],
      edges: [{ id: "legacy-edge", source: "old-image", target: "old-video" }],
    };
    expect(readDocument(document)).toMatchObject({ schemaVersion: 1, edges: document.edges, nodes: document.nodes });
    useCanvas.getState().load(readDocument(document));
    expect(serializeDocument().edges).toEqual(document.edges);
  });
  it("keeps legacy metadata and undo history when applying data-only node updates", () => {
    const id = useCanvas.getState().add("image", { prompt: "历史作品" }, { x: 10, y: 20 });
    const original = serializeDocument();
    original.nodes[0] = { ...original.nodes[0], parentId: "legacy-group", hidden: false };
    useCanvas.getState().load(readDocument(original));
    useCanvas.getState().changes([
      { type: "position", id, position: { x: 30, y: 45 }, dragging: false },
      { type: "dimensions", id, dimensions: { width: 350, height: 200 }, setAttributes: true },
      { type: "select", id, selected: true },
    ]);
    expect(serializeDocument().nodes[0]).toMatchObject({
      position: { x: 30, y: 45 }, width: 350, height: 200,
      parentId: "legacy-group", hidden: false, data: { prompt: "历史作品" },
    });
    expect(serializeDocument().nodes[0]).not.toHaveProperty("measured");
    expect(serializeDocument().nodes[0]).not.toHaveProperty("selected");
    useCanvas.getState().undo();
    expect(serializeDocument()).toEqual(original);
  });
  it("preserves the whole editable document through hot replacement with fresh actions", async () => {
    const image = useCanvas.getState().add("image", { prompt: "已保存的提示词" });
    const video = useCanvas.getState().add("video");
    useCanvas.getState().connect({ source: image, target: video, sourceHandle: "output", targetHandle: "input" });
    useCanvas.getState().markSaved(useCanvas.getState().editVersion);
    useCanvas.getState().patch(image, { title: "未保存的标题" });
    useCanvas.getState().patch(video, { prompt: "下一次可重做的编辑" });
    useCanvas.getState().undo();
    useCanvas.getState().setViewport({ x: -165, y: 70, zoom: 0.8 });
    const oldState = useCanvas.getState();
    const payload = captureCanvasHotState(oldState);
    expect(Object.values(payload.state).every((value) => typeof value !== "function")).toBe(true);
    const restored = restoreCanvasHotState(JSON.parse(JSON.stringify(payload)))!;
    expect(restored).toEqual(JSON.parse(JSON.stringify({
      document: oldState.document, history: oldState.history, future: oldState.future,
      editVersion: oldState.editVersion, savedVersion: oldState.savedVersion,
      loadSerial: oldState.loadSerial + 1,
    })));
    vi.resetModules();
    const replacement = (await import("./store")).useCanvas;
    replacement.setState(restored);
    expect(replacement.getState().patch).not.toBe(oldState.patch);
    replacement.getState().redo();
    expect(replacement.getState().document.nodes.find((node) => node.id === video)?.data.prompt).toBe("下一次可重做的编辑");
    expect(useCanvas.getState().document).toBe(oldState.document);
    expect(replacement.getState().document.viewport).toEqual({ x: -165, y: 70, zoom: 0.8 });
    replacement.getState().patch(image, { prompt: "新模块操作仍然有效" });
    expect(replacement.getState().document.nodes.find((node) => node.id === image)?.data.prompt).toBe("新模块操作仍然有效");
    expect(useCanvas.getState().document.nodes.find((node) => node.id === image)?.data.prompt).toBe("已保存的提示词");
  });
  it("cancels an uncommitted drag during hot replacement while keeping the viewport and dirty counters", () => {
    const id = useCanvas.getState().add("image", {}, { x: 25, y: 40 });
    useCanvas.getState().markSaved(useCanvas.getState().editVersion);
    useCanvas.getState().setViewport({ x: 50, y: -20, zoom: 1.25 });
    const before = useCanvas.getState();
    useCanvas.getState().beginGesture();
    useCanvas.getState().moveSelected(100, 200);
    const restored = restoreCanvasHotState(captureCanvasHotState(useCanvas.getState()))!;
    expect(restored.document.nodes.find((node) => node.id === id)?.position).toEqual({ x: 25, y: 40 });
    expect(restored.document.viewport).toEqual({ x: 50, y: -20, zoom: 1.25 });
    expect(restored.editVersion).toBe(before.editVersion);
    expect(restored.savedVersion).toBe(before.savedVersion);
    expect(restored.history).toEqual(before.history);
    expect(restored).not.toHaveProperty("gesture");
  });
  it("keeps hot state detached from future edits and fails closed on a corrupted snapshot", () => {
    const id = useCanvas.getState().add("note", { prompt: "当前创作" });
    const payload = captureCanvasHotState(useCanvas.getState());
    useCanvas.getState().patch(id, { prompt: "后续创作" });
    expect(payload.state.document.nodes[0].data.prompt).toBe("当前创作");
    expect(restoreCanvasHotState(undefined)).toBeUndefined();
    expect(() => restoreCanvasHotState({ version: 1, state: {} })).toThrow("热更新状态损坏");
  });
  it("gives empty generators room for controls and keeps media and explicit dimensions", () => {
    const id = useCanvas.getState().add("video");
    const node = useCanvas.getState().document.nodes.find((item) => item.id === id)!;
    expect(displaySize(node)).toEqual({ width: 360, height: 260 });
    expect(displaySize({ ...node, data: { ...node.data, url: "/api/assets/result/content" } })).toEqual({ width: 300, height: 168.75 });
    expect(displaySize({ ...node, data: { ...node.data, displayWidth: 420, displayHeight: 180 } })).toEqual({ width: 420, height: 180 });
  });
});
