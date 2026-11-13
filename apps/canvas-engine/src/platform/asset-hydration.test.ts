import { describe, expect, it, vi } from "vitest";
import {
  restoreAssetMedia,
  type AssetHydrationIO,
} from "@/lib/asset-hydration";
import type { Asset, ImageAsset, TextAsset, VideoAsset } from "@/types/asset";

const base = {
  id: "asset",
  title: "Reference",
  coverUrl: "",
  tags: ["scene"],
  createdAt: "2026-01-01",
  updatedAt: "2026-02-01",
  metadata: { prompt: "Keep the original prompt", provenance: ["upload"] },
};
const image = (
  id: string,
  data: Partial<ImageAsset["data"]> = {},
): ImageAsset => ({
  ...base,
  id,
  kind: "image",
  data: {
    dataUrl: "blob:expired",
    storageKey: "image:stored",
    width: 1920,
    height: 1080,
    bytes: 123,
    mimeType: "image/png",
    ...data,
  },
});
const video = (id: string): VideoAsset => ({
  ...base,
  id,
  kind: "video",
  data: {
    url: "blob:old-video",
    storageKey: `video:${id}`,
    width: 1280,
    height: 720,
    bytes: 200,
    mimeType: "video/mp4",
  },
});
const text: TextAsset = {
  ...base,
  id: "text",
  kind: "text",
  data: { content: "script" },
};
const saved = {
  url: "blob:imported",
  storageKey: "image:imported",
  width: 640,
  height: 480,
  bytes: 400,
  mimeType: "image/webp",
};
function makeIO(overrides: Partial<AssetHydrationIO> = {}): AssetHydrationIO {
  return {
    readImage: vi.fn(async () => "blob:original"),
    readVideo: vi.fn(async () => "blob:video"),
    saveImage: vi.fn(async () => saved),
    loadPreview: vi.fn(async () => "blob:thumbnail"),
    ...overrides,
  };
}

describe("project asset media restoration", () => {
  it("dispatches mixed records in order and never replaces the original with a thumbnail", async () => {
    const source = image("image");
    source.coverUrl = source.data.dataUrl;
    const assets = [text, source, video("movie")];
    const io = makeIO();
    const restored = await restoreAssetMedia(assets, io);

    expect(restored.map(({ id }) => id)).toEqual(["text", "image", "movie"]);
    expect(restored[0]).toBe(text);
    expect(restored[1]).toMatchObject({
      coverUrl: "blob:original",
      data: { ...source.data, dataUrl: "blob:original" },
      metadata: base.metadata,
      tags: base.tags,
    });
    expect(restored[2]).toMatchObject({ data: { url: "blob:video" } });
    expect(source.data.dataUrl).toBe("blob:expired");
    expect(source.coverUrl).toBe("blob:expired");
    expect(io.saveImage).not.toHaveBeenCalled();
  });

  it.each(["https://assets.example/custom.jpg", "data:image/png;base64,COVER"])(
    "keeps an independently selected cover during migration: %s",
    async (coverUrl) => {
      const source = image("legacy", {
        storageKey: undefined,
        dataUrl: "data:image/png;base64,ORIGINAL",
      });
      source.coverUrl = coverUrl;
      const [restored] = await restoreAssetMedia([source], makeIO());
      expect(restored).toMatchObject({
        coverUrl,
        data: {
          storageKey: saved.storageKey,
          bytes: saved.bytes,
          mimeType: saved.mimeType,
          dataUrl: saved.url,
        },
      });
      expect(restored.data).not.toHaveProperty("url");
    },
  );

  it("migrates matching legacy covers and fills missing dimensions while preserving existing ones", async () => {
    const source = image("legacy", {
      storageKey: undefined,
      dataUrl: "data:image/png;base64,ORIGINAL",
      width: 0,
    });
    source.coverUrl = source.data.dataUrl;
    const [restored] = await restoreAssetMedia([source], makeIO());
    expect(restored).toMatchObject({
      coverUrl: saved.url,
      data: {
        storageKey: saved.storageKey,
        bytes: saved.bytes,
        mimeType: saved.mimeType,
        width: 640,
        height: 1080,
      },
    });
    expect(source.data.storageKey).toBeUndefined();
    expect(restored.metadata).toBe(source.metadata);
  });

  it("reads a stored original once for stale source and cover, even with duplicate references", async () => {
    const first = image("one");
    first.coverUrl = "blob:other-expired-cover";
    const second = { ...first, id: "two" };
    const io = makeIO();
    const restored = await restoreAssetMedia([first, second], io);
    expect(io.readImage).toHaveBeenCalledTimes(1);
    expect(io.loadPreview).toHaveBeenCalledTimes(1);
    expect(restored.map(({ coverUrl }) => coverUrl)).toEqual([
      "blob:original",
      "blob:original",
    ]);
  });

  it("deduplicates identical legacy uploads without mixing different images", async () => {
    const source = image("one", {
      storageKey: undefined,
      dataUrl: "data:image/png;base64,A",
    });
    const other = image("three", {
      storageKey: undefined,
      dataUrl: "data:image/png;base64,B",
    });
    const io = makeIO();
    await restoreAssetMedia([source, { ...source, id: "two" }, other], io);
    expect(io.saveImage).toHaveBeenCalledTimes(2);
    expect(io.saveImage).toHaveBeenNthCalledWith(1, source.data.dataUrl);
    expect(io.saveImage).toHaveBeenNthCalledWith(2, other.data.dataUrl);
  });

  it("isolates image, video and upload failures and retries in the next batch", async () => {
    const problem = new Error("storage unavailable");
    const fail = vi.fn(async () => {
      throw problem;
    });
    const io = makeIO({ readImage: fail, readVideo: fail, saveImage: fail });
    const assets: Asset[] = [
      image("stored"),
      video("movie"),
      image("inline", {
        storageKey: undefined,
        dataUrl: "data:image/png;base64,A",
      }),
      text,
    ];
    const restored = await restoreAssetMedia(assets, io);
    restored.forEach((record, index) => expect(record).toBe(assets[index]));
    io.readImage = vi.fn(async () => "blob:recovered");
    const [retry] = await restoreAssetMedia([assets[0]], io);
    expect(retry).toMatchObject({ data: { dataUrl: "blob:recovered" } });
  });

  it("retains a restored original if preview loading throws or rejects", async () => {
    const io = makeIO({
      loadPreview: () => {
        throw new Error("thumbnail failed");
      },
    });
    const [restored] = await restoreAssetMedia([image("stored")], io);
    expect(restored).toMatchObject({ data: { dataUrl: "blob:original" } });
  });

  it("does not upload remote images, videos or nonimage data URLs", async () => {
    const sources = [
      image("remote", {
        storageKey: undefined,
        dataUrl: "https://assets.example/image.jpg",
      }),
      image("other-data", {
        storageKey: undefined,
        dataUrl: "data:application/pdf;base64,PDF",
      }),
      {
        ...video("remote-video"),
        data: {
          ...video("remote-video").data,
          storageKey: undefined,
          url: "data:video/mp4;base64,VIDEO",
        },
      },
    ];
    const io = makeIO();
    const restored = await restoreAssetMedia(sources, io);
    restored.forEach((record, index) => expect(record).toBe(sources[index]));
    expect(io.readImage).not.toHaveBeenCalled();
    expect(io.readVideo).not.toHaveBeenCalled();
    expect(io.saveImage).not.toHaveBeenCalled();
  });

  it("limits the complete restoration pipeline to four active media operations", async () => {
    let active = 0;
    let peak = 0;
    async function operation<T>(result: T): Promise<T> {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return result;
    }
    const io = makeIO({
      readImage: () => operation("blob:restored"),
      readVideo: () => operation("blob:video"),
      saveImage: () => operation(saved),
      loadPreview: () => operation("blob:preview"),
    });
    const assets: Asset[] = Array.from({ length: 15 }, (_, index) =>
      index % 3 === 0
        ? video(`${index}`)
        : image(
            `${index}`,
            index % 3 === 1
              ? { storageKey: `image:${index}` }
              : {
                  storageKey: undefined,
                  dataUrl: `data:image/png;base64,${index}`,
                },
          ),
    );
    const restored = await restoreAssetMedia(assets, io);
    expect(restored.map(({ id }) => id)).toEqual(assets.map(({ id }) => id));
    expect(peak).toBe(4);
    expect(active).toBe(0);
  });

  it("does not cache media between batches from different project scopes", async () => {
    const source = image("same-key");
    const firstIO = makeIO({
      readImage: vi.fn(async () => "blob:project-one"),
    });
    const secondIO = makeIO({
      readImage: vi.fn(async () => "blob:project-two"),
    });
    const [first] = await restoreAssetMedia([source], firstIO);
    const [second] = await restoreAssetMedia([source], secondIO);
    expect(first).toMatchObject({ data: { dataUrl: "blob:project-one" } });
    expect(second).toMatchObject({ data: { dataUrl: "blob:project-two" } });
    expect(secondIO.readImage).toHaveBeenCalledTimes(1);
  });

  it("keeps distinct fallbacks for the same missing storage key", async () => {
    const io = makeIO({ readImage: vi.fn(async (_key, fallback) => fallback) });
    const sources = [
      image("one", { dataUrl: "https://assets.example/one" }),
      image("two", { dataUrl: "https://assets.example/two" }),
    ];
    const restored = await restoreAssetMedia(sources, io);
    expect(restored[0]).toBe(sources[0]);
    expect(restored[1]).toBe(sources[1]);
    expect(io.readImage).toHaveBeenCalledTimes(2);
  });
});
