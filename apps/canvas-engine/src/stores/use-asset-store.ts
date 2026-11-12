import { create } from "zustand";
import {
  persist,
  type PersistStorage,
  type StorageValue,
} from "zustand/middleware";
import { nanoid } from "nanoid";

import {
  decodeAssetStorageValue,
  mapWithConcurrency,
  normalizeAssetCollection,
  reduceAssetCollection,
  type PersistedAssetValue,
} from "@/lib/asset-library-model";
import { localForageStorage } from "@/lib/localforage-storage";
import {
  cleanupUnusedImages,
  ensureImagePreview,
  previewUrlFor,
  resolveImageUrl,
  uploadImage,
} from "@/services/image-storage";
import { cleanupUnusedMedia, resolveMediaUrl } from "@/services/file-storage";

export type AssetKind = "text" | "image" | "video";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & {
  data: {
    dataUrl: string;
    storageKey?: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
  };
};
export type VideoAsset = AssetBase<"video"> & {
  data: {
    url: string;
    storageKey?: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
  };
};
export type Asset = TextAsset | ImageAsset | VideoAsset;

type AssetBase<T extends AssetKind> = {
  id: string;
  kind: T;
  title: string;
  coverUrl: string;
  tags: string[];
  source?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
};

type AssetStore = {
  hydrated: boolean;
  assets: Asset[];
  addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => string;
  updateAsset: (
    id: string,
    patch: Partial<Omit<Asset, "id" | "createdAt">>,
  ) => void;
  removeAsset: (id: string) => void;
  replaceAssets: (assets: Asset[]) => void;
  cleanupImages: (extra?: unknown) => void;
};

export function assetCoverUrl(asset: Asset) {
  const imageUrl = asset.kind === "image" ? asset.data.dataUrl : "";
  const selectedCover = asset.coverUrl || imageUrl;
  return asset.kind === "image" && selectedCover === imageUrl
    ? previewUrlFor(asset.data.storageKey) || selectedCover
    : selectedCover;
}

const ASSET_STORE_KEY = "yingxu-atlas:asset_store:v2";
const LEGACY_ASSET_STORE_KEY = "infinite-canvas:asset_store";
const HYDRATION_CONCURRENCY = 4;

const assetStorage: PersistStorage<AssetStore> = {
  getItem: async (name) => {
    const current = await readStorageValue(name);
    const persisted =
      current ?? (await readStorageValue(LEGACY_ASSET_STORE_KEY));
    if (!persisted) return null;

    const assets = normalizeAssetCollection(persisted.state.assets);
    const hydratedAssets = await mapWithConcurrency(
      assets,
      HYDRATION_CONCURRENCY,
      hydrateStoredAsset,
    );

    return {
      ...persisted,
      state: { ...persisted.state, assets: hydratedAssets },
    } as StorageValue<AssetStore>;
  },
  setItem: (name, value) =>
    localForageStorage.setItem(name, JSON.stringify(value)),
  removeItem: (name) => localForageStorage.removeItem(name),
};

async function readStorageValue(
  key: string,
): Promise<PersistedAssetValue | null> {
  try {
    const serialized = await localForageStorage.getItem(key);
    return decodeAssetStorageValue(serialized);
  } catch {
    return null;
  }
}

async function hydrateStoredAsset(asset: Asset): Promise<Asset> {
  if (asset.kind === "video" && asset.data.storageKey) {
    try {
      return {
        ...asset,
        data: {
          ...asset.data,
          url: await resolveMediaUrl(asset.data.storageKey, asset.data.url),
        },
      };
    } catch {
      return asset;
    }
  }

  if (asset.kind !== "image") return asset;

  if (asset.data.storageKey) {
    void ensureImagePreview(asset.data.storageKey).catch(() => undefined);
    try {
      const [dataUrl, coverUrl] = await Promise.all([
        resolveImageUrl(asset.data.storageKey, asset.data.dataUrl),
        asset.coverUrl.startsWith("blob:")
          ? resolveImageUrl(asset.data.storageKey, asset.coverUrl)
          : Promise.resolve(asset.coverUrl),
      ]);
      return { ...asset, coverUrl, data: { ...asset.data, dataUrl } };
    } catch {
      return asset;
    }
  }

  if (!asset.data.dataUrl.startsWith("data:image/")) return asset;
  try {
    const image = await uploadImage(asset.data.dataUrl);
    return {
      ...asset,
      coverUrl: asset.coverUrl.startsWith("data:image/")
        ? image.url
        : asset.coverUrl,
      data: {
        ...asset.data,
        dataUrl: image.url,
        storageKey: image.storageKey,
        bytes: image.bytes,
        mimeType: image.mimeType,
      },
    };
  } catch {
    return asset;
  }
}

export const useAssetStore = create<AssetStore>()(
  persist(
    (set, get) => ({
      hydrated: false,
      assets: [],
      addAsset: (asset) => {
        const now = new Date().toISOString();
        const id = nanoid();
        const record = {
          ...asset,
          id,
          createdAt: now,
          updatedAt: now,
        } as Asset;
        set((state) => ({
          assets: reduceAssetCollection(state.assets, {
            type: "insert",
            asset: record,
          }),
        }));
        return id;
      },
      updateAsset: (id, patch) => {
        set((state) => {
          const assets = reduceAssetCollection(state.assets, {
            type: "update",
            id,
            patch,
            updatedAt: new Date().toISOString(),
          });
          return assets === state.assets ? state : { assets };
        });
      },
      removeAsset: (id) => {
        let removed = false;
        set((state) => {
          const assets = reduceAssetCollection(state.assets, {
            type: "remove",
            id,
          });
          removed = assets !== state.assets;
          return removed ? { assets } : state;
        });
        if (removed) get().cleanupImages({ assets: get().assets });
      },
      replaceAssets: (assets) =>
        set({ assets: normalizeAssetCollection(assets) }),
      cleanupImages: (extra) => {
        globalThis.setTimeout(() => {
          void (async () => {
            const { useCanvasStore } =
              await import("@/stores/canvas/use-canvas-store");
            const usedData = {
              assets: get().assets,
              projects: useCanvasStore.getState().projects,
              extra,
            };
            await Promise.all([
              cleanupUnusedImages(usedData),
              cleanupUnusedMedia(usedData),
            ]);
          })().catch((error) => {
            console.warn("Asset media cleanup failed", error);
          });
        }, 0);
      },
    }),
    {
      name: ASSET_STORE_KEY,
      storage: assetStorage,
      partialize: (state) =>
        ({ assets: state.assets }) as StorageValue<AssetStore>["state"],
      onRehydrateStorage: () => () => {
        useAssetStore.setState({ hydrated: true });
      },
    },
  ),
);
