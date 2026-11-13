import { describe, expect, it } from "vitest";
import { finishStudioWire, studioGestureIntent, studioMarqueeSelection, studioMoveSet, studioResizeGeometry } from "../atlas-engine/studio/useStudioGestures";
import { makeStudioNode, StudioSession, type StudioDocument } from "../atlas-engine/studio/studio-document";

const node = (id: string, x = 0, y = 0, width = 100, height = 100) => ({ ...makeStudioNode("text", x, y, id), id, width, height });
const documentWith = (...nodes: ReturnType<typeof node>[]): StudioDocument => ({ nodes, connections: [], viewport: { x: 0, y: 0, k: 1 }, backgroundMode: "dots", showImageInfo: true });

describe("smart hand navigation", () => {
  const hand = { tool: "pan" as const, button: 0, shiftKey: false, space: false };

  it("moves a node with the same hand that pans an empty area", () => {
    expect(studioGestureIntent({ ...hand, surface: "canvas" })).toBe("pan");
    expect(studioGestureIntent({ ...hand, surface: "node" })).toBe("move");
    expect(studioGestureIntent({ ...hand, surface: "node", shiftKey: true })).toBe("move");
  });

  it("uses Shift and a blank area to select without switching tools", () => {
    expect(studioGestureIntent({ ...hand, surface: "canvas", shiftKey: true })).toBe("marquee");
    const prior = new Set(["kept"]);
    const selected = studioMarqueeSelection([node("picked", 20, 20), node("outside", 500, 500)], { from: { x: 10, y: 10 }, to: { x: 80, y: 80 } }, prior);
    expect([...selected]).toEqual(["kept", "picked"]);
    expect([...prior]).toEqual(["kept"]);
  });

  it.each(["canvas", "node", "port", "resize"] as const)("temporarily navigates over %s with Space or the middle button", surface => {
    expect(studioGestureIntent({ ...hand, surface, button: 1, shiftKey: true })).toBe("pan");
    expect(studioGestureIntent({ ...hand, surface, space: true, shiftKey: true })).toBe("pan");
    expect(studioGestureIntent({ ...hand, surface, button: 2 })).toBe("ignore");
  });

  it("keeps normal wire, resize and legacy selection gestures available", () => {
    expect(studioGestureIntent({ ...hand, surface: "port" })).toBe("wire");
    expect(studioGestureIntent({ ...hand, surface: "resize" })).toBe("resize");
    expect(studioGestureIntent({ ...hand, surface: "canvas", tool: "select" })).toBe("marquee");
  });
});

describe("independent studio gesture geometry", () => {
  it("expands nested groups once and tolerates malformed membership cycles", () => {
    const root = { ...node("group"), type: "group", metadata: { groupId: "nested" } };
    const nested = { ...node("nested"), type: "group", metadata: { groupId: "group" } };
    const member = { ...node("member"), metadata: { groupId: "nested" } };
    expect([...studioMoveSet([root, nested, member, node("outside")], new Set(["group"]))]).toEqual(["group", "nested", "member"]);
  });

  it("selects intersections regardless of drag direction while retaining additive selection", () => {
    const selected = studioMarqueeSelection([node("inside", 20, 20), node("partial", 120, 120), node("outside", 500, 500)], { from: { x: 130, y: 130 }, to: { x: 10, y: 10 } }, new Set(["existing"]));
    expect([...selected]).toEqual(["existing", "inside", "partial"]);
  });

  it.each(["nw", "ne", "sw", "se"] as const)("keeps opposite corner stable when resizing %s below minimum", corner => {
    const original = node("box", 30, 50, 180, 140);
    const delta = { x: corner.endsWith("w") ? 500 : -500, y: corner.startsWith("n") ? 500 : -500 };
    const resized = studioResizeGeometry(original, corner, delta);
    expect(resized.width).toBe(80); expect(resized.height).toBe(64);
    expect(corner.endsWith("w") ? resized.position.x + resized.width : resized.position.x).toBe(corner.endsWith("w") ? 210 : 30);
    expect(corner.startsWith("n") ? resized.position.y + resized.height : resized.position.y).toBe(corner.startsWith("n") ? 190 : 50);
  });
});

describe("studio wire commands", () => {
  it("creates a connected video task from an image with one undo and one redo", () => {
    const source = { ...node("image"), type: "image" };
    const session = new StudioSession(documentWith(source));
    expect(finishStudioWire(session, { nodeId: source.id, side: "source", cursor: { x: 0, y: 0 } }, { x: 500, y: 100 }, null, true)).toBe(true);
    const task = session.read().nodes.find(item => item.id !== source.id)!;
    expect(task.metadata?.generationMode).toBe("video");
    expect(task.metadata?.composerContent).toBe("@[node:image]");
    expect(session.read().connections[0]).toMatchObject({ fromNodeId: source.id, toNodeId: task.id });
    expect(task.position).toEqual({ x: 500, y: 26 });
    session.undo(); expect(session.read().nodes).toHaveLength(1); expect(session.read().connections).toEqual([]); expect(session.snapshot().undo).toBe(false);
    session.redo(); expect(session.read().nodes).toHaveLength(2); expect(session.read().connections).toHaveLength(1);
  });

  it("honors an input port's direction and aligns the new output with the drop point", () => {
    const session = new StudioSession(documentWith(node("result")));
    finishStudioWire(session, { nodeId: "result", side: "target", cursor: { x: 0, y: 0 } }, { x: -120, y: 80 }, null, true);
    const task = session.read().nodes.find(item => item.id !== "result")!;
    expect(task.position.x + task.width).toBe(-120);
    expect(session.read().connections[0]).toMatchObject({ fromNodeId: task.id, toNodeId: "result" });
  });

  it("rejects same-side, duplicate and cyclic wires without recording undo entries", () => {
    const session = new StudioSession(documentWith(node("a"), node("b")));
    const wire = { nodeId: "a", side: "source" as const, cursor: { x: 0, y: 0 } };
    expect(finishStudioWire(session, wire, { x: 0, y: 0 }, { nodeId: "b", side: "source" }, false)).toBe(false);
    expect(session.snapshot().undo).toBe(false);
    expect(finishStudioWire(session, wire, { x: 0, y: 0 }, { nodeId: "b", side: "target" }, false)).toBe(true);
    expect(finishStudioWire(session, wire, { x: 0, y: 0 }, { nodeId: "b" }, false)).toBe(false);
    expect(finishStudioWire(session, { ...wire, nodeId: "b" }, { x: 0, y: 0 }, { nodeId: "a" }, false)).toBe(false);
    session.undo(); expect(session.read().connections).toEqual([]); expect(session.snapshot().undo).toBe(false);
  });

  it("does not create a task outside the canvas or from a removed origin", () => {
    const session = new StudioSession(documentWith(node("a")));
    const wire = { nodeId: "a", side: "source" as const, cursor: { x: 0, y: 0 } };
    expect(finishStudioWire(session, wire, { x: 0, y: 0 }, null, false)).toBe(false);
    session.remove(new Set(["a"]));
    expect(finishStudioWire(session, wire, { x: 0, y: 0 }, null, true)).toBe(false);
    expect(session.read().nodes).toEqual([]);
  });
});
