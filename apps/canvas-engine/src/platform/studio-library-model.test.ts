import { describe, expect, it } from "vitest";
import { canvasLibraryItems, filterLibraryItems, libraryTextAddress, localLibraryItems, projectLibraryItems } from "@/atlas-engine/studio/studio-library-model";
import type { Asset } from "@/types/asset";
import type { CanvasNodeData } from "@/types/canvas";
import type { PlatformAsset } from "@/platform/rpc";

const node = (id: string, type: string, metadata: CanvasNodeData["metadata"]): CanvasNodeData => ({ id, type, title: id, position: { x: 0, y: 0 }, width: 320, height: 220, metadata });
const asset = (id: string, mimeType: string, projectId = "project"): PlatformAsset => ({ id, name: id, url: `/api/assets/${id}/content`, mimeType, size: 100, projectId });

describe("Studio material library sources", () => {
  it("keeps local media identifiers, dimensions and source records intact", () => {
    const original: Asset[] = [{ id: "clip", kind: "video", title: "Recorded clip", tags: ["nature"], coverUrl: "cover", createdAt: "date", updatedAt: "date",
      data: { url: "blob:clip", storageKey: "media:key", width: 1920, height: 1080, bytes: 400, mimeType: "video/webm" } }];
    const snapshot = structuredClone(original);
    expect(localLibraryItems(original)[0]).toMatchObject({ id: "local:clip", preview: "cover", tags: ["nature"],
      payload: { kind: "video", url: "blob:clip", storageKey: "media:key", width: 1920, height: 1080 } });
    expect(original).toEqual(snapshot);
  });

  it("exposes audio and text from the authenticated project and namespaces identical IDs", () => {
    const source = [asset("voice", "audio/ogg"), asset("notes", "text/markdown; charset=utf-8"), asset("movie", "video/webm"), asset("other", "application/zip")];
    expect(projectLibraryItems(source)).toEqual([
      expect.objectContaining({ id: "project:voice", kind: "audio", payload: expect.objectContaining({ kind: "audio", mimeType: "audio/ogg" }) }),
      expect.objectContaining({ id: "project:notes", kind: "text", textUrl: "/api/assets/notes/content" }),
      expect.objectContaining({ id: "project:movie", kind: "video", payload: expect.objectContaining({ mimeType: "video/webm" }) }),
    ]);
    expect(projectLibraryItems(source, "account")[0].id).toBe("account:voice");
    expect(projectLibraryItems([asset("same", "image/png"), asset("same", "image/png")])).toHaveLength(1);
  });

  it("includes every completed batch result while excluding failed previews and generation configs", () => {
    const nodes = [node("batch", "image", { content: "selected", images: [
      { id: "first", content: "/one", status: "success", naturalWidth: 100, naturalHeight: 80, bytes: 30, mimeType: "image/png", storageKey: "original-one" },
      { id: "failed", content: "/bad", status: "error", naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: "" },
      { id: "second", content: "/two", status: "success", naturalWidth: 100, naturalHeight: 80, bytes: 40, mimeType: "image/png" },
    ] }), node("story", "text", { texts: [{ id: "a", content: "Script A", status: "success" }, { id: "b", content: "Script B", status: "success" }] }),
    node("sound", "audio", { content: "blob:sound", storageKey: "audio:original", mimeType: "audio/wav" }),
    node("generator", "config", { content: "prompt" }), node("empty", "image", {})];
    const snapshot = structuredClone(nodes);
    const items = canvasLibraryItems(nodes);
    expect(items.map((item) => item.id)).toEqual(["canvas:batch:first", "canvas:batch:second", "canvas:story:a", "canvas:story:b", "canvas:sound"]);
    expect(items[0].payload).toMatchObject({ kind: "image", dataUrl: "/one", storageKey: "original-one" });
    expect(items[4].payload).toMatchObject({ kind: "audio", url: "blob:sound", storageKey: "audio:original", mimeType: "audio/wav" });
    expect(nodes).toEqual(snapshot);
  });

  it("searches content and tags with multiple terms without altering the collection", () => {
    const items = canvasLibraryItems([node("Scene", "text", { content: "The sky turns blue" }), node("photo", "image", { content: "/sky" })]);
    expect(filterLibraryItems(items, "text", "sky blue")).toHaveLength(1);
    expect(filterLibraryItems(items, "image", "sky blue")).toHaveLength(0);
    expect(filterLibraryItems(items, "all", "   ")).toHaveLength(2);
  });

  it("fetches text only from authenticated same-origin asset endpoints", () => {
    const origin = "https://studio.example";
    expect(libraryTextAddress("/api/assets/notes/content", origin)).toBe("https://studio.example/api/assets/notes/content");
    expect(libraryTextAddress("https://elsewhere.example/api/assets/notes/content", origin)).toBeNull();
    expect(libraryTextAddress("javascript:alert(1)", origin)).toBeNull();
    expect(libraryTextAddress("/api/pool/accounts", origin)).toBeNull();
    expect(libraryTextAddress("https://name:password@studio.example/api/assets/x/content", origin)).toBeNull();
  });
});
