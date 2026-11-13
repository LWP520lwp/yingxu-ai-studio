import type { Asset, AssetKind } from "@/stores/use-asset-store";

export type InsertAssetPayload =
  | {
      kind: "audio";
      url: string;
      title: string;
      storageKey?: string;
      mimeType?: string;
    }
  | { kind: "text"; content: string; title: string }
  | { kind: "image"; dataUrl: string; title: string; storageKey?: string }
  | {
      kind: "video";
      url: string;
      title: string;
      storageKey?: string;
      mimeType?: string;
      width?: number;
      height?: number;
    };

export type AssetPickerKindFilter = "all" | AssetKind;

export const ASSET_PICKER_PAGE_SIZE = 8;

export function filterPickerAssets(
  assets: readonly Asset[],
  kind: AssetPickerKindFilter,
  keyword: string,
): Asset[] {
  const query = keyword.trim().toLowerCase();

  return assets
    .filter((asset) => kind === "all" || asset.kind === kind)
    .filter(
      (asset) =>
        !query ||
        [asset.title, ...(asset.tags || [])]
          .join(" ")
          .toLowerCase()
          .includes(query),
    );
}

export function getAssetPickerPageCount(
  total: number,
  pageSize = ASSET_PICKER_PAGE_SIZE,
): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)));
}

export function clampAssetPickerPage(
  page: number,
  total: number,
  pageSize = ASSET_PICKER_PAGE_SIZE,
): number {
  const pageCount = getAssetPickerPageCount(total, pageSize);
  return Math.min(
    pageCount,
    Math.max(1, Math.floor(Number.isFinite(page) ? page : 1)),
  );
}

export function getAssetPickerPage<T>(
  items: readonly T[],
  page: number,
  pageSize = ASSET_PICKER_PAGE_SIZE,
): T[] {
  const safePageSize = Math.max(
    1,
    Math.floor(Number.isFinite(pageSize) ? pageSize : ASSET_PICKER_PAGE_SIZE),
  );
  const safePage = clampAssetPickerPage(page, items.length, safePageSize);
  return items.slice((safePage - 1) * safePageSize, safePage * safePageSize);
}

export function toInsertAssetPayload(asset: Asset): InsertAssetPayload {
  if (asset.kind === "text") {
    return { kind: "text", content: asset.data.content, title: asset.title };
  }

  if (asset.kind === "video") {
    return {
      kind: "video",
      url: asset.data.url,
      storageKey: asset.data.storageKey,
      title: asset.title,
      width: asset.data.width,
      height: asset.data.height,
    };
  }

  return {
    kind: "image",
    dataUrl: asset.data.dataUrl,
    storageKey: asset.data.storageKey,
    title: asset.title,
  };
}
