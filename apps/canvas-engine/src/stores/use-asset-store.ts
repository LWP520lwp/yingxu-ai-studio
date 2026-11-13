import { create } from "zustand";
import {
  persist,
  type PersistStorage,
  type StorageValue,
} from "zustand/middleware";
import { nanoid } from "nanoid";

import {
  decodeAssetStorageValue,
  normalizeAssetCollection,
  reduceAssetCollection,
  type PersistedAssetValue,
} from "@/lib/asset-library-model";
import { restoreAssetMedia } from "@/lib/asset-hydration";
import { localForageStorage } from "@/lib/localforage-storage";
import { LEGACY_STORAGE_KEYS } from "@/lib/legacy-data-compatibility";
import {
  cleanupUnusedImages,
  ensureImagePreview,
  previewUrlFor,
  resolveImageUrl,
  uploadImage,
} from "@/services/image-storage";
import { cleanupUnusedMedia, resolveMediaUrl } from "@/services/file-storage";
import type { Asset } from "@/types/asset";
export type {
  Asset,
  AssetKind,
  ImageAsset,
  TextAsset,
  VideoAsset,
} from "@/types/asset";

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
let cleanupQueued = false;
let pendingCleanupExtras: unknown[] = [];

function queueUnusedAssetCleanup(readAssets: () => Asset[], extra?: unknown) {
  if (extra !== undefined) pendingCleanupExtras.push(extra);
  if (cleanupQueued) return;
  cleanupQueued = true;
  globalThis.setTimeout(() => {
    cleanupQueued = false;
    const extras = pendingCleanupExtras.splice(0);
    void (async () => {
      const { useCanvasStore } =
        await import("@/stores/canvas/use-canvas-store");
      const usedData = {
        assets: readAssets(),
        projects: useCanvasStore.getState().projects,
        extra: extras,
      };
      await Promise.all([
        cleanupUnusedImages(usedData),
        cleanupUnusedMedia(usedData),
      ]);
    })().catch((error) => {
      console.warn("Asset media cleanup failed", error);
    });
  }, 0);
}

const assetStorage: PersistStorage<AssetStore> = {
  getItem: async (name) => {
    const current = await readStorageValue(name);
    const persisted =
      current ?? (await readStorageValue(LEGACY_STORAGE_KEYS.assets));
    if (!persisted) return null;

    const assets = normalizeAssetCollection(persisted.state.assets);
    const hydratedAssets = await restoreAssetMedia(assets, {
      readImage: resolveImageUrl,
      readVideo: resolveMediaUrl,
      saveImage: uploadImage,
      loadPreview: ensureImagePreview,
    });

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
        if (removed) queueUnusedAssetCleanup(() => get().assets);
      },
      replaceAssets: (assets) =>
        set({ assets: normalizeAssetCollection(assets) }),
      cleanupImages: (extra) => {
        queueUnusedAssetCleanup(() => get().assets, extra);
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
