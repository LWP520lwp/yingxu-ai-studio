import { describe, expect, it, vi } from "vitest";

import { createAtlasGenerationCoordinator, atlasGenerationScopeKey } from "@/atlas-engine/workflows/generation-coordinator";

function fixture() {
  let scope = { projectId: "project-a", scopeId: "session-a" };
  const coordinator = createAtlasGenerationCoordinator(() => scope);
  return { coordinator, switchScope: () => { scope = { projectId: "project-b", scopeId: "session-b" }; } };
}

describe("Atlas scoped generation coordinator", () => {
  it("cleans up every registered output after a successful run", async () => {
    const { coordinator } = fixture();
    const settled = vi.fn();
    const status = await coordinator.run({
      nodeId: "source",
      prepare: async () => "prepared",
      execute: async (context, lease) => {
        expect(context).toBe("prepared");
        lease.track("image");
        lease.track("text");
        expect(coordinator.has("image")).toBe(true);
        expect(lease.owns("text")).toBe(true);
      },
      failed: vi.fn(),
      settled,
    });

    expect(status).toBe("completed");
    expect(["source", "image", "text"].some(coordinator.has)).toBe(false);
    expect(settled).toHaveBeenCalledWith(expect.any(Object), true);
  });

  it("does not execute or mark errors when preparation returns after a project change", async () => {
    const { coordinator, switchScope } = fixture();
    const execute = vi.fn();
    const failed = vi.fn();
    const settled = vi.fn();
    const status = await coordinator.run({ nodeId: "source", prepare: async () => { switchScope(); }, execute, failed, settled });

    expect(status).toBe("cancelled");
    expect(execute).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
    expect(settled).toHaveBeenCalledWith(expect.any(Object), false);
    expect(coordinator.has("source")).toBe(false);
  });

  it("guards deferred state updates against a changed project scope", () => {
    const { coordinator, switchScope } = fixture();
    const controller = coordinator.begin("source", "source");
    const update = coordinator.guard("source", controller, (value: number) => value + 1);
    expect(update(1)).toBe(2);
    switchScope();
    expect(update(1)).toBe(1);
    expect(coordinator.canWrite("source", controller)).toBe(false);
  });

  it("never reuses a controller from a different project scope", () => {
    const { coordinator, switchScope } = fixture();
    const controller = coordinator.begin("source", "source");
    switchScope();
    coordinator.begin("output", "source", "source", controller);
    expect(controller.signal.aborted).toBe(true);
    expect(coordinator.has("output")).toBe(false);
  });

  it("preserves replacement ownership when an older run finishes later", async () => {
    const { coordinator } = fixture();
    let replacement: AbortController | undefined;
    const failed = vi.fn();
    const settled = vi.fn();
    const status = await coordinator.run({
      nodeId: "source",
      prepare: async () => null,
      execute: async (_context, lease) => {
        lease.track("output");
        replacement = coordinator.begin("output", "new-source");
        throw new Error("Late failure from cancelled run");
      },
      failed,
      settled,
    });

    expect(status).toBe("cancelled");
    expect(failed).not.toHaveBeenCalled();
    expect(coordinator.isCurrent("output", replacement!)).toBe(true);
    expect(settled).toHaveBeenCalledWith(expect.any(Object), true);
  });

  it("cancels all tracked targets through the user-facing running id", async () => {
    const { coordinator } = fixture();
    const status = await coordinator.run({
      nodeId: "source",
      runningId: "busy-card",
      prepare: async () => null,
      execute: async (_context, lease) => {
        lease.track("output");
        const affected = coordinator.cancelRunning("busy-card");
        expect([...affected].sort()).toEqual(["output", "source"]);
        expect(lease.controller.signal.aborted).toBe(true);
      },
      failed: vi.fn(),
    });
    expect(status).toBe("cancelled");
    expect(coordinator.has("source")).toBe(false);
    expect(coordinator.has("output")).toBe(false);
  });

  it("reports genuine errors once and still releases every target", async () => {
    const { coordinator } = fixture();
    const failed = vi.fn();
    const error = new Error("Provider rejected the request");
    const status = await coordinator.run({ nodeId: "source", prepare: async () => null, execute: async (_context, lease) => { lease.track("output"); throw error; }, failed });
    expect(status).toBe("failed");
    expect(failed).toHaveBeenCalledOnce();
    expect(failed).toHaveBeenCalledWith(error, expect.any(Object));
    expect(coordinator.has("output")).toBe(false);
  });

  it("uses unambiguous polling keys across projects and sessions", () => {
    expect(atlasGenerationScopeKey({ projectId: "a:b", scopeId: "c" }, "node")).not.toBe(atlasGenerationScopeKey({ projectId: "a", scopeId: "b:c" }, "node"));
    expect(atlasGenerationScopeKey({ projectId: "a", scopeId: "session1" }, "node")).not.toBe(atlasGenerationScopeKey({ projectId: "a", scopeId: "session2" }, "node"));
  });
});
