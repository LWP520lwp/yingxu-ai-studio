import { nanoid } from "nanoid";

import { createScopedStorage } from "@/lib/localforage-storage";
import { withLocalProxy } from "@/stores/use-config-store";
import { collectStorageGarbage } from "./storage-garbage-collector";
import {
  abortReason,
  collectStoredKeys,
  fetchBlobWithDeadline,
  isServerAssetUrl,
  ObjectUrlRegistry,
  throwIfAborted,
} from "@/services/media-storage-runtime";

export type UploadedFile = {
  url: string;
  storageKey: string;
  bytes: number;
  mimeType: string;
  width?: number;
  height?: number;
  durationMs?: number;
};

export type MediaUploadOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

const store = createScopedStorage("media_files");
const objectUrls = new ObjectUrlRegistry();
const DEFAULT_IO_TIMEOUT_MS = 10 * 60_000;
const METADATA_TIMEOUT_MS = 10_000;

export async function uploadMediaFile(
  input: string | Blob,
  prefix = "file",
  options: MediaUploadOptions = {},
): Promise<UploadedFile> {
  throwIfAborted(options.signal);
  const blob =
    typeof input === "string"
      ? await fetchBlobWithDeadline(withLocalProxy(input), {
          signal: options.signal,
          timeoutMs: options.timeoutMs ?? DEFAULT_IO_TIMEOUT_MS,
          responseError: () => new Error("Media download failed"),
          timeoutError: () => new Error("Media download timed out"),
        })
      : input;
  throwIfAborted(options.signal);

  const storageKey = `${prefix}:${nanoid()}`;
  await store.setItem(storageKey, blob);
  try {
    throwIfAborted(options.signal);
    const url = objectUrls.put(storageKey, blob);
    const meta = await readMediaMeta(url, blob.type, options.signal);
    throwIfAborted(options.signal);
    return {
      url,
      storageKey,
      bytes: blob.size,
      mimeType: blob.type || "application/octet-stream",
      ...meta,
    };
  } catch (error) {
    objectUrls.invalidate(storageKey);
    await store.removeItem(storageKey).catch(() => undefined);
    throw error;
  }
}

export async function resolveMediaUrl(storageKey?: string, fallback = "") {
  if (isServerAssetUrl(fallback)) return fallback;
  if (!storageKey) return fallback;
  return (
    (await objectUrls.resolve(storageKey, () =>
      store.getItem<Blob>(storageKey),
    )) || fallback
  );
}

export async function getMediaBlob(storageKey: string) {
  return store.getItem<Blob>(storageKey);
}

export async function setMediaBlob(storageKey: string, blob: Blob) {
  await store.setItem(storageKey, blob);
  return objectUrls.put(storageKey, blob);
}

export async function deleteStoredMedia(keys: Iterable<string>) {
  await Promise.all(
    Array.from(new Set(keys)).map(async (key) => {
      objectUrls.invalidate(key);
      await store.removeItem(key);
    }),
  );
}

export async function cleanupUnusedMedia(usedData: unknown) {
  await collectStorageGarbage({
    retained: collectMediaStorageKeys(usedData),
    stores: [{ storage: store, remove: (key) => deleteStoredMedia([key]) }],
  });
}

export function collectMediaStorageKeys(
  value: unknown,
  keys = new Set<string>(),
) {
  return collectStoredKeys(value, (key) => key.includes(":"), keys);
}

async function readMediaMeta(
  url: string,
  mimeType: string,
  signal?: AbortSignal,
) {
  if (mimeType.startsWith("video/")) {
    return readVideoMeta(url, signal);
  }
  if (mimeType.startsWith("audio/")) {
    return readAudioMeta(url, signal);
  }
  return {};
}

function readVideoMeta(url: string, signal?: AbortSignal) {
  return readElementMeta(url, "video", signal, (element) => ({
    width: (element as HTMLVideoElement).videoWidth || 1280,
    height: (element as HTMLVideoElement).videoHeight || 720,
    durationMs: durationMs(element.duration),
  }));
}

function readAudioMeta(url: string, signal?: AbortSignal) {
  return readElementMeta(url, "audio", signal, (element) => ({
    durationMs: durationMs(element.duration),
  }));
}

function readElementMeta<Result extends Record<string, number | undefined>>(
  url: string,
  kind: "video" | "audio",
  signal: AbortSignal | undefined,
  getResult: (element: HTMLMediaElement) => Result,
): Promise<Result> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const element = document.createElement(kind) as HTMLMediaElement;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      const result = error ? undefined : getResult(element);
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      element.onloadedmetadata = null;
      element.onerror = null;
      element.removeAttribute("src");
      element.load();
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () =>
      finish(
        signal
          ? abortReason(signal)
          : new DOMException("Aborted", "AbortError"),
      );
    const timer = setTimeout(() => finish(), METADATA_TIMEOUT_MS);
    signal?.addEventListener("abort", abort, { once: true });
    element.preload = "metadata";
    element.onloadedmetadata = () => finish();
    element.onerror = () => finish();
    element.src = url;
  });
}

function durationMs(duration: number) {
  return Number.isFinite(duration) && duration >= 0
    ? Math.round(duration * 1000)
    : undefined;
}
