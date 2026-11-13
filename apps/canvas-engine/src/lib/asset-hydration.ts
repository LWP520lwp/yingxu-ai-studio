import { mapConcurrent } from "@/lib/async-pool";
import type { Asset, ImageAsset } from "@/types/asset";

type SavedImage = {
  url: string;
  storageKey?: string;
  width: number;
  height: number;
  bytes: number;
  mimeType: string;
};

export type AssetHydrationIO = {
  readImage(key: string, fallback: string): Promise<string>;
  readVideo(key: string, fallback: string): Promise<string>;
  saveImage(source: string): Promise<SavedImage>;
  loadPreview(key: string): Promise<unknown>;
};

/** One batch belongs to the caller's current account/project; no media cache crosses it. */
export function restoreAssetMedia(
  assets: readonly Asset[],
  io: AssetHydrationIO,
): Promise<Asset[]> {
  const batch = new MediaRestoreBatch(io);
  return mapConcurrent(assets, 4, (asset) => batch.restore(asset));
}

class MediaRestoreBatch {
  private readonly imageReads = new Map<string, Promise<string>>();
  private readonly videoReads = new Map<string, Promise<string>>();
  private readonly imageWrites = new Map<string, Promise<SavedImage>>();
  private readonly previewReads = new Map<string, Promise<unknown>>();

  constructor(private readonly io: AssetHydrationIO) {}

  async restore(asset: Asset): Promise<Asset> {
    try {
      switch (asset.kind) {
        case "text":
          return asset;
        case "video": {
          const { storageKey, url } = asset.data;
          if (!storageKey) return asset;
          const restored = await reuse(this.videoReads, [storageKey, url], () =>
            this.io.readVideo(storageKey, url),
          );
          return restored && restored !== url
            ? { ...asset, data: { ...asset.data, url: restored } }
            : asset;
        }
        case "image":
          return asset.data.storageKey
            ? await this.recoverImage(asset, asset.data.storageKey)
            : /^data:image\//i.test(asset.data.dataUrl)
              ? await this.migrateImage(asset)
              : asset;
      }
    } catch {
      // A failed record keeps its original source and metadata for the next restore attempt.
      return asset;
    }
  }

  private async recoverImage(
    asset: ImageAsset,
    key: string,
  ): Promise<ImageAsset> {
    const url =
      (await reuse(this.imageReads, [key, asset.data.dataUrl], () =>
        this.io.readImage(key, asset.data.dataUrl),
      )) || asset.data.dataUrl;
    const coverUrl = repairedCover(asset, url);

    // A missing thumbnail must never discard a successfully restored original.
    await reuse(this.previewReads, [key], () => this.io.loadPreview(key)).catch(
      () => undefined,
    );

    return url === asset.data.dataUrl && coverUrl === asset.coverUrl
      ? asset
      : { ...asset, coverUrl, data: { ...asset.data, dataUrl: url } };
  }

  private async migrateImage(asset: ImageAsset): Promise<ImageAsset> {
    const saved = await reuse(this.imageWrites, [asset.data.dataUrl], () =>
      this.io.saveImage(asset.data.dataUrl),
    );
    if (!saved.url) return asset;
    return {
      ...asset,
      coverUrl: repairedCover(asset, saved.url),
      data: {
        ...asset.data,
        dataUrl: saved.url,
        storageKey: saved.storageKey,
        bytes: saved.bytes,
        mimeType: saved.mimeType,
        width: asset.data.width || saved.width,
        height: asset.data.height || saved.height,
      },
    };
  }
}

function repairedCover(asset: ImageAsset, source: string) {
  const followsOriginal =
    asset.coverUrl === asset.data.dataUrl || asset.coverUrl.startsWith("blob:");
  return followsOriginal && source ? source : asset.coverUrl;
}

/** Deduplicate work within a restore, but release rejected work so it can be retried. */
function reuse<T>(
  cache: Map<string, Promise<T>>,
  identity: readonly string[],
  start: () => Promise<T>,
): Promise<T> {
  const key = JSON.stringify(identity);
  const cached = cache.get(key);
  if (cached) return cached;
  const work = Promise.resolve().then(start);
  cache.set(key, work);
  void work.catch(() => {
    if (cache.get(key) === work) cache.delete(key);
  });
  return work;
}
