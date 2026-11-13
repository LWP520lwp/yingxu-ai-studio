import { describe, expect, it, vi } from "vitest";

import { applyAtlasImageEditMedia, createAtlasImageEditGuard, executeAtlasImageEdit, planAtlasAngleImageEdit, planAtlasMaskImageEdit, restoreAtlasImageEditCancellation } from "@/atlas-engine/workflows/image-edit-plan";
import { defaultConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const media = { url: "/image.png", storageKey: "image-key", width: 1000, height: 500, bytes: 32, mimeType: "image/png" };
const source = (): CanvasNodeData => ({ id: "source", type: CanvasNodeType.Image, title: "Reference", position: { x: 10, y: 20 }, width: 320, height: 240, metadata: { content: "/original.png", storageKey: "source-key", mimeType: "image/png" } });
const angle = () => planAtlasAngleImageEdit({ source: source(), outputId: "output", config: defaultConfig, title: "Side view", prompt: "Show this subject from the side" });

describe("Atlas image editing plans", () => {
  it("keeps mask and source as separate references, with an editable draft when generation is deferred", () => {
    const plan = planAtlasMaskImageEdit({ source: source(), outputId: "output", config: defaultConfig, mask: media, prompt: "Only replace the masked background", title: "Masked result", maskTitle: "Mask", generate: false });

    expect(plan.nodes).toHaveLength(2);
    expect(plan.references.map((reference) => reference.storageKey)).toEqual(["source-key", "image-key"]);
    expect(plan.nodes[0].position).toEqual({ x: 10, y: 356 });
    expect(plan.nodes[1].metadata).toEqual({ prompt: "Only replace the masked background" });
    expect(plan.commands.filter((command) => command.type === "connect")).toHaveLength(2);
    expect(plan.commands.at(-1)).toEqual({ type: "select", nodeIds: ["output"] });
  });

  it("applies generated dimensions, prompt and model metadata without modifying the source", () => {
    const plan = angle();
    const nodes = [plan.source, ...plan.nodes];
    const result = applyAtlasImageEditMedia(nodes, plan, media);

    expect(result[0]).toBe(plan.source);
    expect(result[1].metadata).toMatchObject({ content: "/image.png", prompt: plan.prompt, model: defaultConfig.model, status: "success", generationMode: "image", naturalWidth: 1000, naturalHeight: 500 });
    expect(result[1].width / result[1].height).toBe(2);
    expect(result[1].width).toBeLessThanOrEqual(plan.bounds.width);
  });

  it("refuses to overwrite results after the source image has been replaced", () => {
    const plan = angle();
    const changed = { ...plan.source, metadata: { ...plan.source.metadata, content: "/replacement.png" } };
    const result = applyAtlasImageEditMedia([changed, ...plan.nodes], plan, media);

    expect(result[1]).toBe(plan.nodes[0]);
    expect(result[1].metadata?.status).toBe("loading");
  });

  it("rejects project switches, source removal and cancelled requests at the same guard boundary", () => {
    const original = source();
    const controller = new AbortController();
    let current: CanvasNodeData | undefined = original;
    let sameScope = true;
    const assertCurrent = createAtlasImageEditGuard(original, controller.signal, () => current, () => sameScope);
    expect(assertCurrent).not.toThrow();
    sameScope = false;
    expect(assertCurrent).toThrow(expect.objectContaining({ name: "AbortError" }));
    sameScope = true;
    current = undefined;
    expect(assertCurrent).toThrow(expect.objectContaining({ name: "AbortError" }));
    current = original;
    controller.abort();
    expect(assertCurrent).toThrow(expect.objectContaining({ name: "AbortError" }));
  });

  it("does not upload a provider response after its source context becomes stale", async () => {
    const plan = angle();
    let scopeCurrent = true;
    const signal = new AbortController().signal;
    const assertCurrent = createAtlasImageEditGuard(plan.source, signal, () => plan.source, () => scopeCurrent);
    const store = vi.fn(async () => media);

    await expect(executeAtlasImageEdit({ plan, signal, assertCurrent, store, edit: vi.fn(async () => { scopeCurrent = false; return [{ id: "result", dataUrl: "late-image" }]; }) })).rejects.toMatchObject({ name: "AbortError" });
    expect(store).not.toHaveBeenCalled();
  });

  it("passes the signal to editing and storage, and fails explicitly on an empty provider response", async () => {
    const plan = angle();
    const signal = new AbortController().signal;
    const edit = vi.fn(async () => [{ id: "result", dataUrl: "image-data" }]);
    const store = vi.fn(async () => media);
    await expect(executeAtlasImageEdit({ plan, signal, edit, store, assertCurrent: () => {} })).resolves.toBe(media);
    expect(edit).toHaveBeenCalledWith(plan.config, plan.prompt, plan.references, { signal });
    expect(store).toHaveBeenCalledWith("image-data", { signal });

    await expect(executeAtlasImageEdit({ plan, signal, edit: vi.fn(async () => []), store, assertCurrent: () => {} })).rejects.toThrow("Image provider returned no image");
    expect(store).toHaveBeenCalledOnce();
  });

  it("resets only the pending cancelled output and leaves finished siblings alone", () => {
    const plan = angle();
    const finished = { ...source(), id: "finished", metadata: { status: "success" as const } };
    const result = restoreAtlasImageEditCancellation([plan.source, plan.nodes[0], finished], plan.outputId);
    expect(result[0]).toBe(plan.source);
    expect(result[1].metadata?.status).toBe("idle");
    expect(result[2]).toBe(finished);
  });
});
