import { describe, expect, it, vi } from "vitest";
import { createStudioMedia, type StudioMediaDependencies } from "@/atlas-engine/studio/studio-media";
import type { StudioDocument, StudioPort } from "@/atlas-engine/studio/studio-document";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { AiConfig } from "@/stores/use-config-store";
import type { UploadedImage } from "@/services/image-storage";

vi.mock("@/lib/localforage-storage", () => ({
  localForageStorage: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined },
  createScopedStorage: () => ({ getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined }),
}));

const stored = (key: string): UploadedImage => ({ url: `blob:${key}`, storageKey: key, width: 800, height: 600, mimeType: "image/png", bytes: 100 });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(type: CanvasNodeType = CanvasNodeType.Image, overrides: Partial<StudioMediaDependencies> = {}) {
  const source: CanvasNodeData = { id: "source", type, title: "素材", position: { x: 10, y: 20 }, width: 320, height: 240, metadata: { content: "blob:source", storageKey: "existing", mimeType: type === CanvasNodeType.Image ? "image/png" : "video/mp4" } };
  let document: StudioDocument = { nodes: [source], connections: [], viewport: { x: 0, y: 0, k: 1 }, backgroundMode: "dots", showImageInfo: false };
  let sequence = 0;
  const notice = vi.fn();
  const port: StudioPort = { read: () => document, change: (recipe) => { document = recipe(document); }, insert: (nodes, connections = []) => { document = { ...document, nodes: [...document.nodes, ...nodes], connections: [...document.connections, ...connections] }; }, alive: () => true, notice };
  const image = vi.fn<StudioMediaDependencies["image"]>(async () => stored(`new-${++sequence}`));
  const removeImages = vi.fn<StudioMediaDependencies["removeImages"]>(async () => undefined);
  const edit = vi.fn<StudioMediaDependencies["edit"]>(async () => [{ id: "edited", dataUrl: "data:image/png;base64,ZWRpdGVk" }]);
  const capture = vi.fn<StudioMediaDependencies["capture"]>(async () => new Blob(["frame"], { type: "image/png" }));
  const io: Partial<StudioMediaDependencies> = {
    image, edit, capture, removeImages,
    removeFiles: async () => undefined,
    resolveImage: async (_key, fallback) => fallback || "",
    dimensions: async () => ({ width: 800, height: 600, mimeType: "image/png" }),
    crop: async () => "data:image/png;base64,Y3JvcA==",
    split: async () => [{ row: 0, column: 0, dataUrl: "data:image/png;base64,cGFydA==" }],
    upscale: async () => "data:image/png;base64,dXBzY2FsZQ==",
    configuration: (config) => config,
    id: () => String(++sequence),
    ...overrides,
  };
  const media = createStudioMedia(port, () => ({ model: "platform::image" }) as AiConfig, io);
  return { media, io, port, source, image, edit, capture, notice, removeImages, read: () => document,
    mutate: (recipe: (value: StudioDocument) => StudioDocument) => { document = recipe(document); } };
}

describe("independent studio media transactions", () => {
  it("limits parallel uploads to three and commits imported media in file order", async () => {
    const f = fixture();
    const gates = Array.from({ length: 5 }, () => deferred<UploadedImage>());
    let started = 0;
    f.image.mockImplementation(() => gates[started++].promise);
    const work = f.media.importFiles(gates.map((_, i) => new File(["a"], `${i}.png`, { type: "image/png" })));
    await vi.waitFor(() => expect(started).toBe(3));
    gates[2].resolve(stored("file-2"));
    await vi.waitFor(() => expect(started).toBe(4));
    gates[3].resolve(stored("file-3"));
    await vi.waitFor(() => expect(started).toBe(5));
    gates[4].resolve(stored("file-4")); gates[1].resolve(stored("file-1")); gates[0].resolve(stored("file-0"));
    await work;
    expect(f.read().nodes.slice(1).map((node) => node.title)).toEqual(["0.png", "1.png", "2.png", "3.png", "4.png"]);
    expect(f.removeImages).not.toHaveBeenCalled();
  });

  it("rolls back late uploads after one worker fails without deleting an existing key", async () => {
    const f = fixture();
    const gates = Array.from({ length: 3 }, () => deferred<UploadedImage>());
    let started = 0;
    f.image.mockImplementation(() => gates[started++].promise);
    const work = f.media.importFiles(gates.map((_, i) => new File(["a"], `${i}.png`, { type: "image/png" })));
    await vi.waitFor(() => expect(started).toBe(3));
    gates[0].reject(new Error("upload failed")); gates[1].resolve(stored("existing")); gates[2].resolve(stored("late-new"));
    await work;
    expect(f.read().nodes).toHaveLength(1);
    expect(f.removeImages).toHaveBeenCalledExactlyOnceWith(["late-new"]);
    expect(f.notice).toHaveBeenCalledWith("upload failed");
  });

  it("does not attach a crop to a source that changed while its image was stored", async () => {
    const f = fixture();
    const gate = deferred<UploadedImage>();
    f.image.mockReturnValueOnce(gate.promise);
    const work = f.media.edit(f.source, "crop", { x: 0, y: 0, width: 100, height: 100 });
    await vi.waitFor(() => expect(f.image).toHaveBeenCalledOnce());
    f.mutate((document) => ({ ...document, nodes: document.nodes.map((node) => ({ ...node, metadata: { ...node.metadata, content: "blob:replacement" } })) }));
    gate.resolve(stored("crop-new")); await work;
    expect(f.read().nodes).toHaveLength(1);
    expect(f.removeImages).toHaveBeenCalledExactlyOnceWith(["crop-new"]);
    expect(f.notice).not.toHaveBeenCalled();
  });

  it("reuses an existing asset storage key instead of reuploading it", async () => {
    const f = fixture();
    await f.media.insertAsset({ kind: "image", dataUrl: "blob:asset", title: "已有素材", storageKey: "asset-key" });
    expect(f.image).not.toHaveBeenCalled();
    expect(f.read().nodes[1].metadata).toMatchObject({ storageKey: "asset-key", content: "blob:asset" });
  });

  it("inserts an audio asset without image conversion and preserves its playable URL and MIME", async () => {
    const f = fixture();
    const url = "/api/assets/audio-clip/content";
    const committed = await f.media.insertAsset({ kind: "audio", url, title: "环境音", storageKey: "audio-key", mimeType: "audio/ogg; codecs=opus" });
    expect(committed).toBe(true);
    expect(f.image).not.toHaveBeenCalled();
    expect(f.read().nodes[1]).toMatchObject({
      type: CanvasNodeType.Audio,
      title: "环境音",
      width: 360,
      height: 100,
      metadata: { content: url, storageKey: "audio-key", mimeType: "audio/ogg; codecs=opus", status: "success" },
    });
    expect(f.read().connections).toEqual([]);
    expect(f.removeImages).not.toHaveBeenCalled();
  });

  it("uses the audio fallback MIME instead of a video MIME when none was supplied", async () => {
    const f = fixture();
    expect(await f.media.insertAsset({ kind: "audio", url: "blob:audio", title: "旁白" })).toBe(true);
    expect(f.read().nodes[1].metadata).toMatchObject({ content: "blob:audio", mimeType: "audio/mpeg" });
  });

  it("reads the actual canvas center afresh for both text and playable asset insertion", async () => {
    const center = vi.fn<NonNullable<StudioMediaDependencies["center"]>>()
      .mockReturnValueOnce({ x: 812.5, y: -160.25 })
      .mockReturnValueOnce({ x: -224.5, y: 640.75 });
    const f = fixture(CanvasNodeType.Image, { center });
    f.mutate(document => ({ ...document, viewport: { x: 500, y: -700, k: 0.5 } }));
    expect(await f.media.insertAsset({ kind: "text", content: "新的想法", title: "笔记" })).toBe(true);
    expect(f.read().nodes[1].position).toEqual({ x: 812.5, y: -160.25 });
    expect(await f.media.insertAsset({ kind: "audio", url: "blob:audio", title: "旁白" })).toBe(true);
    expect(f.read().nodes[2].position).toEqual({ x: -224.5, y: 640.75 });
    expect(center).toHaveBeenCalledTimes(2);
  });

  it("reports failed insertion as false and leaves the document untouched", async () => {
    const f = fixture();
    f.image.mockRejectedValueOnce(new Error("asset upload rejected"));
    expect(await f.media.insertAsset({ kind: "image", dataUrl: "data:image/png;base64,YQ==", title: "失败素材" })).toBe(false);
    expect(f.read().nodes).toEqual([f.source]);
    expect(f.notice).toHaveBeenCalledExactlyOnceWith("asset upload rejected");
  });

  it("returns false after cancellation and rolls back an upload that completes late", async () => {
    const f = fixture();
    const gate = deferred<UploadedImage>();
    f.image.mockReturnValueOnce(gate.promise);
    const work = f.media.insertAsset({ kind: "image", dataUrl: "data:image/png;base64,YQ==", title: "取消素材" });
    await vi.waitFor(() => expect(f.image).toHaveBeenCalledOnce());
    f.media.dispose();
    expect(f.image.mock.calls[0][1]?.signal?.aborted).toBe(true);
    gate.resolve(stored("cancelled-asset"));
    expect(await work).toBe(false);
    expect(f.read().nodes).toEqual([f.source]);
    expect(f.removeImages).toHaveBeenCalledExactlyOnceWith(["cancelled-asset"]);
    expect(f.notice).not.toHaveBeenCalled();
    expect(await f.media.insertAsset({ kind: "audio", url: "blob:late-audio", title: "已关闭" })).toBe(false);
    expect(f.read().nodes).toEqual([f.source]);
  });

  it("extracts the actual last video frame and connects it to the video", async () => {
    const f = fixture(CanvasNodeType.Video);
    await f.media.capture(f.source, "end");
    expect(f.capture).toHaveBeenCalledExactlyOnceWith("blob:source", "last", 0);
    expect(f.read().nodes[1].type).toBe(CanvasNodeType.Image);
    expect(f.read().connections[0]).toMatchObject({ fromNodeId: "source", toNodeId: f.read().nodes[1].id });
  });

  it("uses image generation for a new camera angle and retains source references", async () => {
    const f = fixture();
    await f.media.edit(f.source, "angle", { horizontalAngle: 35, pitchAngle: 10, cameraDistance: 1, wideAngle: false });
    expect(f.edit).toHaveBeenCalledOnce();
    expect(f.edit.mock.calls[0][1]).toContain("35");
    expect(f.edit.mock.calls[0][2]).toMatchObject([{ id: "source", storageKey: "existing" }]);
    expect(f.read().nodes[1].metadata?.prompt).toContain("新相机视角");
  });

  it("can prepare a connected mask recipe without calling a provider", async () => {
    const f = fixture();
    await f.media.edit(f.source, "mask", { prompt: "将外套换成蓝色", maskDataUrl: "data:image/png;base64,bWFzaw==", generate: false });
    expect(f.edit).not.toHaveBeenCalled();
    expect(f.read().nodes).toHaveLength(3);
    const target = f.read().nodes.find((node) => node.type === CanvasNodeType.Config)!;
    expect(target.metadata?.composerContent).toContain("@[node:source]");
    expect(f.read().connections.filter((edge) => edge.toNodeId === target.id)).toHaveLength(2);
  });

  it("removes a newly stored mask if the real image provider rejects the edit", async () => {
    const f = fixture(); f.edit.mockRejectedValueOnce(new Error("model does not support masks"));
    await f.media.edit(f.source, "mask", { prompt: "修改外套颜色", maskDataUrl: "data:image/png;base64,bWFzaw==", generate: true });
    expect(f.edit).toHaveBeenCalledOnce();
    expect(f.edit.mock.calls[0][2]).toHaveLength(2);
    expect(f.read().nodes).toHaveLength(1);
    expect(f.removeImages).toHaveBeenCalledOnce();
    expect(f.notice).toHaveBeenCalledWith("model does not support masks");
  });

  it("rejects replacing an image with a video before any upload or draft mutation", async () => {
    const f = fixture();
    await f.media.importFiles([new File(["a"], "clip.mp4", { type: "video/mp4" })], "source");
    expect(f.image).not.toHaveBeenCalled();
    expect(f.read().nodes).toEqual([f.source]);
    expect(f.notice).toHaveBeenCalledOnce();
  });

  it("rolls back a completed upload when the editor is disposed mid import", async () => {
    const f = fixture();
    const gate = deferred<UploadedImage>(); f.image.mockReturnValueOnce(gate.promise);
    const work = f.media.importFiles([new File(["a"], "image.png", { type: "image/png" })]);
    await vi.waitFor(() => expect(f.image).toHaveBeenCalledOnce());
    f.media.dispose(); gate.resolve(stored("discarded")); await work;
    expect(f.read().nodes).toHaveLength(1);
    expect(f.removeImages).toHaveBeenCalledExactlyOnceWith(["discarded"]);
  });
});
