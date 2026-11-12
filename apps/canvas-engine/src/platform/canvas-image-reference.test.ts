import { describe, expect, it } from "vitest";
import { readCanvasImageReference } from "@/lib/canvas/canvas-image-reference";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeImage } from "@/types/canvas";

const result = (id: string, status: CanvasNodeImage["status"] = "success"): CanvasNodeImage => ({
  id, status, content: `/${id}`, storageKey: `image:${id}`, mimeType: "image/webp", bytes: 32, naturalWidth: 80, naturalHeight: 60,
});
const node = (metadata: CanvasNodeData["metadata"]): CanvasNodeData => ({
  id: "source", title: "Source", type: CanvasNodeType.Image, position: { x: 0, y: 0 }, width: 80, height: 60, metadata,
});

describe("restored image references", () => {
  it("uses the visible result and its storage scope before batch fallbacks", () => {
    expect(readCanvasImageReference(node({ content: "/visible", storageKey: "image:visible", images: [result("batch")] })))
      .toMatchObject({ dataUrl: "/visible", storageKey: "image:visible" });
  });

  it("restores the selected successful batch result without substituting a failed slot", () => {
    const source = node({ primaryImageId: "selected", images: [result("failed", "error"), result("first"), result("selected")] });
    expect(readCanvasImageReference(source)).toMatchObject({ dataUrl: "/selected", storageKey: "image:selected" });
    expect(readCanvasImageReference(node({ images: [result("failed", "error")] }))).toBeNull();
  });
});
