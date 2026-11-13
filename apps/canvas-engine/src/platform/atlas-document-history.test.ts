import { describe, expect, it } from "vitest";

import {
  createAtlasHistory,
  recordAtlasSnapshot,
  redoAtlasHistory,
  undoAtlasHistory,
} from "@/atlas-engine/history/document-history";
import { reduceAtlasDocument } from "@/atlas-engine/reducer";
import { createAtlasDocument, type AtlasNode } from "@/atlas-engine/model";

describe("Atlas snapshot history", () => {
  it("keeps a bounded undo stack and discards redo after a new edit", () => {
    let history = createAtlasHistory("a", 2);
    history = recordAtlasSnapshot(history, "b");
    history = recordAtlasSnapshot(history, "c");
    history = recordAtlasSnapshot(history, "d");

    expect(history.past).toEqual(["b", "c"]);
    history = undoAtlasHistory(history);
    expect(history.present).toBe("c");
    history = redoAtlasHistory(history);
    expect(history.present).toBe("d");

    history = undoAtlasHistory(history);
    history = recordAtlasSnapshot(history, "edited");
    expect(history.future).toEqual([]);
    expect(redoAtlasHistory(history)).toBe(history);
  });

  it("returns the same state for unchanged snapshots and empty stack operations", () => {
    const history = createAtlasHistory({ value: 1 });
    expect(recordAtlasSnapshot(history, history.present)).toBe(history);
    expect(undoAtlasHistory(history)).toBe(history);
    expect(redoAtlasHistory(history)).toBe(history);
  });

  it("rejects invalid capacities", () => {
    expect(() => createAtlasHistory("initial", 0)).toThrow("正整数");
    expect(() => createAtlasHistory("initial", 1.5)).toThrow("正整数");
  });

  it("retains the newest fifty committed snapshots by default", () => {
    let history = createAtlasHistory(0);
    for (let value = 1; value <= 55; value += 1) {
      history = recordAtlasSnapshot(history, value);
    }
    expect(history.past).toHaveLength(50);
    expect(history.past[0]).toBe(5);
    expect(history.present).toBe(55);
  });

  it("undoes and redoes immutable document revisions", () => {
    const node: AtlasNode = {
      id: "camera",
      kind: "image",
      title: "Camera",
      frame: { x: 0, y: 0, width: 200, height: 120 },
    };
    const initial = createAtlasDocument({ nodes: [node] });
    const moved = reduceAtlasDocument(initial, {
      type: "move-nodes",
      ids: [node.id],
      delta: { x: 60, y: -15 },
    });
    let history = recordAtlasSnapshot(createAtlasHistory(initial), moved);

    history = undoAtlasHistory(history);
    expect(history.present.nodes[0]?.frame).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 120,
    });
    history = redoAtlasHistory(history);
    expect(history.present.nodes[0]?.frame).toEqual({
      x: 60,
      y: -15,
      width: 200,
      height: 120,
    });
    expect(initial.nodes[0]?.frame.x).toBe(0);
  });
});
