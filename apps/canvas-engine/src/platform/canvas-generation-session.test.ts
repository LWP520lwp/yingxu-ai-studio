import { describe, expect, it, vi } from "vitest";
import { createAtlasGenerationSession as createCanvasGenerationSession } from "@/atlas-engine/workflows/generation-session";

describe("canvas generation ownership", () => {
  it("cancels an entire shared batch before replacing its target and rejects late writes", () => {
    const session = createCanvasGenerationSession();
    const first = session.begin("source", "source");
    session.begin("image", "source", "source", first);
    const next = session.begin("source", "source");
    expect(first.signal.aborted).toBe(true);
    expect(session.has("image")).toBe(false);
    expect(session.isCurrent("source", next)).toBe(true);
    expect(session.finish("source", first)).toBe(false);
    expect(session.canWrite("source", first)).toBe(false);
  });

  it("releases all registrations after an externally aborted batch", () => {
    const session = createCanvasGenerationSession();
    const controller = session.begin("a", "a");
    session.begin("b", "a", "a", controller);
    controller.abort();
    expect(session.has("a")).toBe(false);
    expect(session.has("b")).toBe(false);
    expect(session.canWrite("b", controller)).toBe(false);
  });

  it("stops only the chosen run and reports all affected source/output nodes", () => {
    const session = createCanvasGenerationSession();
    const a = session.begin("source", "source");
    session.begin("output", "source", "source", a);
    const independent = session.begin("other", "other");
    expect([...session.cancelRunning("source")].sort()).toEqual([
      "output",
      "source",
    ]);
    expect(a.signal.aborted).toBe(true);
    expect(independent.signal.aborted).toBe(false);
    expect(session.cancelRunning("source").size).toBe(0);
  });

  it.each(["source", "output"])(
    "cancels dependent work when %s is deleted",
    (deleted) => {
      const session = createCanvasGenerationSession();
      const controller = session.begin("output", "source");
      expect(session.cancelNodes(new Set([deleted]))).toEqual(
        new Set(["output", "source"]),
      );
      expect(controller.signal.aborted).toBe(true);
      expect(session.canWrite("output", controller)).toBe(false);
    },
  );

  it("allows queued successful updates after finish but not after a newer run or clear", () => {
    const session = createCanvasGenerationSession();
    const first = session.begin("a", "a");
    const lateUpdate = session.guard("a", first, (value: number) => value + 1);
    expect(session.finish("a", first)).toBe(true);
    expect(session.canWrite("a", first)).toBe(true);
    expect(lateUpdate(10)).toBe(11);
    const next = session.begin("a", "a");
    expect(session.canWrite("a", first)).toBe(false);
    expect(lateUpdate(10)).toBe(10);
    session.finish("a", next);
    session.cancelAll();
    expect(session.canWrite("a", next)).toBe(false);
  });

  it("can cancel repeatedly and restart after effect cleanup without keeping abort listeners", () => {
    const session = createCanvasGenerationSession();
    const controller = new AbortController();
    const abort = vi.spyOn(controller, "abort");
    session.begin("a", "a", "a", controller);
    session.begin("b", "a", "a", controller);
    session.cancelAll();
    session.cancelAll();
    expect(abort).toHaveBeenCalledTimes(1);
    const next = session.begin("next", "next");
    expect(session.isCurrent("next", next)).toBe(true);
    const preaborted = new AbortController();
    preaborted.abort();
    session.begin("gone", "gone", "gone", preaborted);
    expect(session.has("gone")).toBe(false);
  });

  it("keeps cleanup from an aborted run from clearing a replacement run", () => {
    const session = createCanvasGenerationSession();
    const first = session.begin("source", "source");
    const deferredCleanup = (status: string) =>
      session.isLastWriter("source", first) ? "idle" : status;
    session.cancelRunning("source");
    expect(session.isLastWriter("source", first)).toBe(true);
    const replacement = session.begin("source", "source");
    expect(deferredCleanup("loading")).toBe("loading");
    expect(session.isLastWriter("source", replacement)).toBe(true);
    expect(session.canWrite("source", replacement)).toBe(true);
  });
});
