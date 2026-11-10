import { describe, expect, it } from "vitest";
import { assembledPrompt, canvasInputs } from "./canvasInputs";
import type { CanvasDocument, CreativeNode } from "./types";

const node = (id: string, kind: "note" | "image" | "video", extra = {}): CreativeNode => ({
  id, type: "creative", position: { x: 0, y: 0 }, data: { kind, title: id, prompt: "", ...extra },
});
describe("visible canvas inputs", () => {
  it("assembles a connected text prompt without requiring a second prompt on the target", () => {
    const document: CanvasDocument = {
      schemaVersion: 1, nodes: [node("text", "note", { prompt: "生成森林图片" }), node("image", "image")],
      edges: [{ id: "line", source: "text", target: "image" }],
    };
    expect(assembledPrompt(canvasInputs(document, "image").notes, "")).toBe("生成森林图片");
    document.edges = [];
    expect(assembledPrompt(canvasInputs(document, "image").notes, "")).toBe("");
  });
  it("deduplicates legacy dependencies and image assets and exposes unusable reference types", () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [node("a", "image", { assetId: "same" }), node("b", "image", { assetId: "same" }),
        node("pending", "image"), node("video", "video"),
        node("target", "video", { sourceNodeIds: ["a", "b"] })],
      edges: ["a", "b", "pending", "video"].map((source) => ({ id: source, source, target: "target" })),
    };
    expect(canvasInputs(document, "target")).toMatchObject({ imageIds: ["same"], pendingImages: 1, videos: 1 });
    expect(canvasInputs(document, "target").sources).toHaveLength(4);
  });
});
