import { createScopedStorage } from "@/lib/localforage-storage";
import i18n from "@/i18n";
import { PRODUCT_FILE_ID } from "@/lib/product-identity";
import {
  decodeSyncManifest,
  type SyncDomainKey,
  type SyncManifest,
  type SyncManifestFile,
} from "@/lib/sync/manifest-codec";
import { mergeByTimestamp, mergeCanvasSyncData } from "@/lib/sync/merge-policy";
import {
  collectMediaStorageKeys,
  mediaNeedsUpload,
  planMediaDownloads,
} from "@/lib/sync/media-plan";
import {
  getMediaBlob,
  resolveMediaUrl,
  setMediaBlob,
} from "@/services/file-storage";
import {
  getImageBlob,
  resolveImageUrl,
  setImageBlob,
} from "@/services/image-storage";
import {
  downloadWebdavFile,
  uploadWebdavFile,
  WEBDAV_MANIFEST_FILE_NAME,
} from "@/services/webdav-sync";
import type { Asset } from "@/stores/use-asset-store";
import { useAssetStore } from "@/stores/use-asset-store";
import type { WebdavSyncConfig } from "@/stores/use-config-store";
import type {
  CanvasDeletedProject,
  CanvasProject,
} from "@/stores/canvas/use-canvas-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

type StoredRecord = Record<string, unknown> & { id?: string };
type CanvasData = {
  projects: CanvasProject[];
  deleted: CanvasDeletedProject[];
};
type AssetData = { assets: Asset[] };
type RecordData = { logs: StoredRecord[] };
type Manifest<T> = SyncManifest<T>;
type LocalStore = ReturnType<typeof createScopedStorage>;

export type AppSyncDomainKey = SyncDomainKey;
export type AppSyncProgressEvent = {
  domain?: AppSyncDomainKey;
  label?: string;
  stage: string;
  current?: number;
  total?: number;
  status?: "active" | "success" | "exception";
};
export type AppSyncProgress = (event: AppSyncProgressEvent) => void;
export type AppSyncOptions = { signal?: AbortSignal };
export type AppSyncResult = {
  syncedAt: string;
  mergedRemote: boolean;
  projects: number;
  assets: number;
  imageLogs: number;
  videoLogs: number;
  files: number;
  manifestBytes: number;
  uploadedFiles: number;
  uploadedBytes: number;
};

type DomainAdapter<T> = {
  id: AppSyncDomainKey;
  label: string;
  empty: T;
  read: () => Promise<T>;
  merge: (local: T, remote: T) => T;
  write?: (value: T) => Promise<void>;
};

type DomainResult<T> = {
  value: T;
  remoteUsed: boolean;
  files: SyncManifestFile[];
  manifestBytes: number;
  uploadedFiles: number;
  uploadedBytes: number;
};

const transferLimit = 3;
const imageLogs = createScopedStorage("image_generation_logs");
const videoLogs = createScopedStorage("video_generation_logs");

export async function syncAppDataToWebdav(
  config: WebdavSyncConfig,
  onProgress?: AppSyncProgress,
  options: AppSyncOptions = {},
): Promise<AppSyncResult> {
  const { signal } = options;
  throwIfAborted(signal);
  progress(onProgress, "等待本地数据加载");
  await Promise.all([
    waitUntilHydrated(useCanvasStore, signal),
    waitUntilHydrated(useAssetStore, signal),
  ]);
  throwIfAborted(signal);

  const domains = buildDomains();
  const results = await Promise.all(
    domains.map((domain) =>
      synchronizeDomain(config, domain, onProgress, signal),
    ),
  );
  const byId = new Map(results.map((result) => [result.domain, result]));
  const canvas = byId.get("canvas")!.value as CanvasData;
  const assets = byId.get("assets")!.value as AssetData;
  const images = byId.get("image-workbench")!.value as RecordData;
  const videos = byId.get("video-workbench")!.value as RecordData;
  const output: AppSyncResult = {
    syncedAt: new Date().toISOString(),
    mergedRemote: results.some((result) => result.remoteUsed),
    projects: canvas.projects.length,
    assets: assets.assets.length,
    imageLogs: images.logs.length,
    videoLogs: videos.logs.length,
    files: results.reduce((sum, result) => sum + result.files.length, 0),
    manifestBytes: results.reduce(
      (sum, result) => sum + result.manifestBytes,
      0,
    ),
    uploadedFiles: results.reduce(
      (sum, result) => sum + result.uploadedFiles,
      0,
    ),
    uploadedBytes: results.reduce(
      (sum, result) => sum + result.uploadedBytes,
      0,
    ),
  };
  progress(onProgress, "同步完成", undefined, "success");
  return output;
}

function buildDomains(): DomainAdapter<unknown>[] {
  return [
    {
      id: "canvas",
      label: "画布",
      empty: { projects: [], deleted: [] } satisfies CanvasData,
      read: async () => {
        const { projects, deletedProjects } = useCanvasStore.getState();
        return { projects, deleted: deletedProjects } satisfies CanvasData;
      },
      merge: (local, remote) =>
        mergeCanvasSyncData(local as CanvasData, remote as CanvasData),
      write: async (value) => {
        const data = value as CanvasData;
        useCanvasStore.getState().replaceProjects(data.projects, data.deleted);
      },
    },
    {
      id: "assets",
      label: "我的资产",
      empty: { assets: [] } satisfies AssetData,
      read: async () => ({ assets: useAssetStore.getState().assets }),
      merge: (local, remote) => ({
        assets: mergeByTimestamp(
          (local as AssetData).assets,
          (remote as AssetData).assets,
          "updatedAt",
        ),
      }),
      write: async (value) => {
        const data = value as AssetData;
        useAssetStore
          .getState()
          .replaceAssets(await Promise.all(data.assets.map(restoreAsset)));
      },
    },
    recordDomain("image-workbench", "生图工作台", imageLogs),
    recordDomain("video-workbench", "视频创作台", videoLogs),
  ];
}

function recordDomain(
  id: "image-workbench" | "video-workbench",
  label: string,
  store: LocalStore,
): DomainAdapter<unknown> {
  return {
    id,
    label,
    empty: { logs: [] },
    read: async () => ({ logs: await readRecords(store) }),
    merge: (local, remote) => ({
      logs: mergeByTimestamp(
        (local as RecordData).logs,
        (remote as RecordData).logs,
        "createdAt",
      ),
    }),
    write: async (value) => replaceRecords(store, (value as RecordData).logs),
  };
}

async function synchronizeDomain<T>(
  config: WebdavSyncConfig,
  domain: DomainAdapter<T>,
  onProgress?: AppSyncProgress,
  signal?: AbortSignal,
): Promise<{ domain: AppSyncDomainKey } & DomainResult<T>> {
  try {
    throwIfAborted(signal);
    report(onProgress, domain, "读取远端清单");
    const remote = await readManifest(config, domain.id, domain.empty, signal);
    report(onProgress, domain, "读取本地数据");
    const local = await domain.read();
    const merged = remote ? domain.merge(local, remote.data) : local;
    if (remote) {
      report(onProgress, domain, "下载缺失媒体");
      await downloadAbsentMedia(
        config,
        domain,
        merged,
        remote.files,
        onProgress,
        signal,
      );
      report(onProgress, domain, "写入本地合并结果");
      await domain.write?.(merged);
    }
    report(onProgress, domain, "上传新增媒体");
    const transfer = await uploadChangedMedia(
      config,
      domain.id,
      merged,
      remote?.files || [],
      onProgress,
      signal,
    );
    const envelope: Manifest<T> = {
      app: PRODUCT_FILE_ID,
      version: 1,
      domain: domain.id,
      exportedAt: new Date().toISOString(),
      data: merged,
      files: transfer.files,
    };
    const manifest = new Blob([JSON.stringify(envelope, null, 2)], {
      type: "application/json",
    });
    report(onProgress, domain, `上传清单 ${formatBytes(manifest.size)}`);
    await uploadWebdavFile(
      config,
      pathFor(domain.id, WEBDAV_MANIFEST_FILE_NAME),
      manifest,
      "application/json",
      signal,
    );
    report(onProgress, domain, "完成", 1, 1, "success");
    return {
      domain: domain.id,
      value: merged,
      remoteUsed: Boolean(remote),
      ...transfer,
      manifestBytes: manifest.size,
    };
  } catch (error) {
    emit(onProgress, {
      domain: domain.id,
      label: domain.label,
      stage:
        error instanceof Error
          ? error.message
          : i18n.t("config.webdav.errors.syncFailed"),
      status: "exception",
    });
    throw error;
  }
}

async function readManifest<T>(
  config: WebdavSyncConfig,
  domain: AppSyncDomainKey,
  empty: T,
  signal?: AbortSignal,
) {
  const file = await downloadWebdavFile(
    config,
    pathFor(domain, WEBDAV_MANIFEST_FILE_NAME),
    signal,
  );
  if (!file) return null;
  try {
    return decodeSyncManifest(await file.text(), domain, empty);
  } catch {
    throw new Error(i18n.t("config.webdav.errors.invalidManifest", { domain }));
  }
}

async function downloadAbsentMedia<T>(
  config: WebdavSyncConfig,
  domain: DomainAdapter<T>,
  data: T,
  manifestFiles: SyncManifestFile[],
  onProgress?: AppSyncProgress,
  signal?: AbortSignal,
) {
  const keys = collectMediaStorageKeys(data);
  const localKeys = new Set<string>();
  await forEachLimited(keys, async (key) => {
    throwIfAborted(signal);
    const exists = key.startsWith("image:")
      ? await getImageBlob(key)
      : await getMediaBlob(key);
    if (exists) localKeys.add(key);
  });
  const tasks = planMediaDownloads(keys, localKeys, manifestFiles);
  if (!tasks.length) {
    report(onProgress, domain, "媒体已齐全", 1, 1);
    return;
  }
  let count = 0;
  await forEachLimited(tasks, async (file) => {
    throwIfAborted(signal);
    const blob = await downloadWebdavFile(config, file.path, signal);
    if (blob) {
      const media = blob.type ? blob : blob.slice(0, blob.size, file.mimeType);
      if (file.storageKey.startsWith("image:"))
        await setImageBlob(file.storageKey, media);
      else await setMediaBlob(file.storageKey, media);
    }
    count += 1;
    report(onProgress, domain, "下载媒体", count, tasks.length);
  });
}

async function uploadChangedMedia<T>(
  config: WebdavSyncConfig,
  domain: AppSyncDomainKey,
  data: T,
  previous: SyncManifestFile[],
  onProgress?: AppSyncProgress,
  signal?: AbortSignal,
) {
  const oldByKey = new Map(previous.map((file) => [file.storageKey, file]));
  const nextFiles: SyncManifestFile[] = [];
  const pending: Array<{ file: SyncManifestFile; blob: Blob }> = [];
  const keys = collectMediaStorageKeys(data);
  for (const storageKey of keys) {
    throwIfAborted(signal);
    const blob = storageKey.startsWith("image:")
      ? await getImageBlob(storageKey)
      : await getMediaBlob(storageKey);
    const old = oldByKey.get(storageKey);
    if (!blob) {
      if (old) nextFiles.push(old);
      continue;
    }
    const file: SyncManifestFile = {
      storageKey,
      path:
        old?.path ||
        pathFor(
          domain,
          `files/${safeName(storageKey)}.${extension(blob.type, storageKey)}`,
        ),
      mimeType: blob.type || old?.mimeType || "application/octet-stream",
      bytes: blob.size,
    };
    nextFiles.push(file);
    if (
      mediaNeedsUpload(
        { storageKey, bytes: file.bytes, mimeType: file.mimeType },
        old,
      )
    )
      pending.push({ file, blob });
  }
  let uploadedFiles = 0;
  let uploadedBytes = 0;
  await forEachLimited(pending, async ({ file, blob }) => {
    throwIfAborted(signal);
    await uploadWebdavFile(config, file.path, blob, file.mimeType, signal);
    uploadedFiles += 1;
    uploadedBytes += blob.size;
    report(
      onProgress,
      { id: domain, label: labelFor(domain) },
      `上传媒体 ${formatBytes(blob.size)}`,
      uploadedFiles,
      pending.length,
    );
  });
  return { files: nextFiles, uploadedFiles, uploadedBytes };
}

async function restoreAsset(asset: Asset): Promise<Asset> {
  if (asset.kind === "image" && asset.data.storageKey) {
    const url = await resolveImageUrl(
      asset.data.storageKey,
      asset.data.dataUrl,
    );
    return {
      ...asset,
      coverUrl: asset.coverUrl.startsWith("blob:") ? url : asset.coverUrl,
      data: { ...asset.data, dataUrl: url },
    };
  }
  if (asset.kind === "video" && asset.data.storageKey) {
    const url = await resolveMediaUrl(asset.data.storageKey, asset.data.url);
    return {
      ...asset,
      coverUrl: asset.coverUrl.startsWith("blob:") ? url : asset.coverUrl,
      data: { ...asset.data, url },
    };
  }
  return asset;
}

async function readRecords(store: LocalStore) {
  const rows: StoredRecord[] = [];
  await store.iterate<StoredRecord, void>((value) => {
    if (value && typeof value === "object") rows.push(value);
  });
  return rows;
}

async function replaceRecords(store: LocalStore, rows: StoredRecord[]) {
  await store.clear();
  await forEachLimited(rows, async (row) => {
    if (typeof row.id === "string" && row.id) await store.setItem(row.id, row);
  });
}

async function waitUntilHydrated<T extends { hydrated: boolean }>(
  store: {
    getState: () => T;
    subscribe: (listener: (state: T) => void) => () => void;
  },
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
  if (store.getState().hydrated) return;
  await new Promise<void>((resolve, reject) => {
    let stop: () => void = () => {};
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      stop();
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onHydrated = (state: T) => {
      if (state.hydrated) finish();
    };
    const onAbort = () => {
      try {
        throwIfAborted(signal);
      } catch (error) {
        finish(error);
      }
    };
    stop = store.subscribe(onHydrated);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    else onHydrated(store.getState());
  });
}

async function forEachLimited<T>(
  items: T[],
  work: (item: T, index: number) => Promise<void>,
) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(transferLimit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        await work(items[index], index);
      }
    }),
  );
}

function report(
  onProgress: AppSyncProgress | undefined,
  domain: Pick<DomainAdapter<unknown>, "id" | "label">,
  stage: string,
  current?: number,
  total?: number,
  status: "active" | "success" | "exception" = "active",
) {
  emit(onProgress, {
    domain: domain.id,
    label: domain.label,
    stage,
    current,
    total,
    status,
  });
}

function progress(
  onProgress: AppSyncProgress | undefined,
  stage: string,
  domain?: AppSyncDomainKey,
  status?: "active" | "success" | "exception",
) {
  emit(onProgress, { stage, domain, status });
}

function emit(
  onProgress: AppSyncProgress | undefined,
  event: AppSyncProgressEvent,
) {
  onProgress?.(event);
}

function pathFor(domain: AppSyncDomainKey, path: string) {
  return `${domain}/${path}`;
}

function labelFor(domain: AppSyncDomainKey) {
  if (domain === "canvas") return "画布";
  if (domain === "assets") return "我的资产";
  if (domain === "image-workbench") return "生图工作台";
  return "视频创作台";
}

function safeName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "_");
}

function extension(mime: string, key: string) {
  const known: Array<[string, string]> = [
    ["png", "png"],
    ["jpeg", "jpg"],
    ["webp", "webp"],
    ["gif", "gif"],
    ["mp4", "mp4"],
    ["webm", "webm"],
    ["wav", "wav"],
    ["mpeg", "mp3"],
    ["mp3", "mp3"],
  ];
  return (
    known.find(([type]) => mime.includes(type))?.[1] ||
    (key.startsWith("image:") ? "png" : "bin")
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
