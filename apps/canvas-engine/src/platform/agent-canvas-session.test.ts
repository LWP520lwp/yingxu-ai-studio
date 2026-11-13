import { describe, expect, it, vi } from "vitest";
import { CanvasAgentSession } from "@/lib/agent-canvas-session";
import type { CanvasAgentSnapshot } from "@/atlas-engine/agent/canvas-operations";

function harness() {
  let snapshot: CanvasAgentSnapshot = {
    projectId: "one", title: "One", nodes: [], connections: [], selectedNodeIds: [],
    viewport: { x: 0, y: 0, k: 1 },
  };
  const generate = vi.fn();
  const historyChanged = vi.fn();
  const session = new CanvasAgentSession({
    read: () => snapshot,
    write: (next) => { snapshot = next; },
    generate,
    historyChanged,
  });
  return { session, generate, historyChanged, read: () => snapshot };
}

describe("scoped canvas agent session", () => {
  it("commits related operations atomically and undoes once", () => {
    const h = harness();
    const original = h.read();
    h.session.apply([{ type: "add_node", id: "text" }, { type: "select_nodes", ids: ["text"] }]);
    expect(h.read().nodes).toHaveLength(1);
    expect(h.historyChanged).toHaveBeenLastCalledWith(true);
    expect(h.session.undo()).toBe(original);
    expect(h.read()).toBe(original);
    expect(h.session.undo()).toBeNull();
  });

  it("drops scheduled generation and stale writes when a project retires", async () => {
    const h = harness();
    h.session.apply([
      { type: "add_node", id: "text", metadata: { prompt: "story" } },
      { type: "run_generation", nodeId: "text", mode: "text" },
    ]);
    h.session.retire();
    h.session.apply([{ type: "delete_node", id: "text" }]);
    await Promise.resolve();
    expect(h.read().nodes).toHaveLength(1);
    expect(h.generate).not.toHaveBeenCalled();
    expect(h.session.undo()).toBeNull();
  });
});
