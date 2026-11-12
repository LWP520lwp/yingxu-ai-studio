import type {
  Asset,
  ImageAsset,
  TextAsset,
  VideoAsset,
} from "@/types/asset";

export type AssetPatch = Partial<Omit<Asset, "id" | "createdAt">>;

export type AssetCollectionAction =
  | { type: "insert"; asset: Asset }
  | { type: "update"; id: string; patch: AssetPatch; updatedAt: string }
  | { type: "remove"; id: string }
  | { type: "replace"; assets: Asset[] };

export type PersistedAssetValue = {
  state: Record<string, unknown>;
  [key: string]: unknown;
};

export function decodeAssetStorageValue(
  serialized: string | null | undefined,
): PersistedAssetValue | null {
  if (!serialized) return null;
  try {
    const value: unknown = JSON.parse(serialized);
    return isRecord(value) && isRecord(value.state)
      ? (value as PersistedAssetValue)
      : null;
  } catch {
    return null;
  }
}

export function reduceAssetCollection(
  current: Asset[],
  action: AssetCollectionAction,
): Asset[] {
  switch (action.type) {
    case "insert":
      return [action.asset, ...current];
    case "update": {
      let changed = false;
      const next = current.map((asset) => {
        if (asset.id !== action.id) return asset;
        changed = true;
        return {
          ...asset,
          ...action.patch,
          id: asset.id,
          createdAt: asset.createdAt,
          updatedAt: action.updatedAt,
        } as Asset;
      });
      return changed ? next : current;
    }
    case "remove": {
      const next = current.filter((asset) => asset.id !== action.id);
      return next.length === current.length ? current : next;
    }
    case "replace":
      return action.assets;
  }
}

export function normalizeAssetCollection(
  value: unknown,
  fallbackTimestamp = new Date().toISOString(),
): Asset[] {
  if (!Array.isArray(value)) return [];

  const assets: Asset[] = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    const asset = normalizeAsset(candidate, fallbackTimestamp);
    if (!asset || ids.has(asset.id)) continue;
    ids.add(asset.id);
    assets.push(asset);
  }
  return assets;
}

export async function mapWithConcurrency<T, Result>(
  values: readonly T[],
  concurrency: number,
  map: (value: T, index: number) => Promise<Result>,
): Promise<Result[]> {
  if (!values.length) return [];
  const limit = Math.max(
    1,
    Math.min(values.length, Math.floor(concurrency) || 1),
  );
  const results = new Array<Result>(values.length);
  let cursor = 0;

  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (cursor < values.length) {
        const index = cursor++;
        results[index] = await map(values[index], index);
      }
    }),
  );
  return results;
}

function normalizeAsset(value: unknown, timestamp: string): Asset | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  if (typeof value.id !== "string" || !value.id.trim()) return null;

  const base = {
    id: value.id,
    title: stringValue(value.title),
    coverUrl: stringValue(value.coverUrl),
    tags: stringList(value.tags),
    source: optionalString(value.source),
    note: optionalString(value.note),
    createdAt: stringValue(value.createdAt, timestamp),
    updatedAt: stringValue(value.updatedAt, timestamp),
    metadata: isRecord(value.metadata) ? value.metadata : undefined,
  };

  if (value.kind === "text") {
    return {
      ...base,
      kind: "text",
      data: { content: stringValue(value.data.content) },
    } satisfies TextAsset;
  }

  if (value.kind === "image") {
    const storageKey = optionalString(value.data.storageKey);
    const dataUrl = stringValue(value.data.dataUrl);
    if (!storageKey && !dataUrl) return null;
    return {
      ...base,
      kind: "image",
      data: {
        dataUrl,
        storageKey,
        width: nonNegativeNumber(value.data.width),
        height: nonNegativeNumber(value.data.height),
        bytes: nonNegativeNumber(value.data.bytes),
        mimeType: stringValue(value.data.mimeType),
      },
    } satisfies ImageAsset;
  }

  if (value.kind === "video") {
    const storageKey = optionalString(value.data.storageKey);
    const url = stringValue(value.data.url);
    if (!storageKey && !url) return null;
    return {
      ...base,
      kind: "video",
      data: {
        url,
        storageKey,
        width: nonNegativeNumber(value.data.width),
        height: nonNegativeNumber(value.data.height),
        bytes: nonNegativeNumber(value.data.bytes),
        mimeType: stringValue(value.data.mimeType),
      },
    } satisfies VideoAsset;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function nonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}
