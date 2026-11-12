import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { createImageThumbnail } from "@/lib/image-thumbnail";
import { createScopedStorage } from "@/lib/localforage-storage";
import { withLocalProxy } from "@/stores/use-config-store";
import {
  abortReason,
  collectStoredKeys,
  fetchBlobWithDeadline,
  isServerAssetUrl,
  ObjectUrlRegistry,
  throwIfAborted,
} from "@/services/media-storage-runtime";

export type UploadedImage = {
  url: string;
  storageKey?: string;
  width: number;
  height: number;
  bytes: number;
  mimeType: string;
};

type ImageReadOptions = { signal?: AbortSignal; timeoutMs?: number };
type StoredImagePreview = { version: number; blob?: Blob };

const imageStore = createScopedStorage("image_files");
const previewStore = createScopedStorage("image_previews");
const imageLogStore = createScopedStorage("image_generation_logs");
const videoLogStore = createScopedStorage("video_generation_logs");
const objectUrls = new ObjectUrlRegistry();
const previewUrls = new ObjectUrlRegistry();
const previewListeners = new Set<() => void>();
const previewRequests = new Map<string, Promise<void>>();
const IMAGE_PREVIEW_VERSION = 1;
const IMAGE_IO_TIMEOUT_MS = 10 * 60_000;
const IMAGE_DECODE_TIMEOUT_MS = 10_000;
const IMAGE_RESPONSE_ERROR = "ImageResponseError";
const IMAGE_TIMEOUT_ERROR = "ImageTimeoutError";
let previewRevision = 0;
let previewQueue: Promise<void> = Promise.resolve();

export async function uploadImage(
  input: string | Blob,
  options: ImageReadOptions = {},
): Promise<UploadedImage> {
  throwIfAborted(options.signal);
  if (typeof input !== "string") return storeImage(input, options);

  let blob: Blob;
  try {
    blob = await fetchImageBlob(input, options);
  } catch (error) {
    if (
      options.signal?.aborted ||
      isNamedError(error, IMAGE_RESPONSE_ERROR) ||
      isNamedError(error, IMAGE_TIMEOUT_ERROR) ||
      !/^https?:\/\//i.test(input)
    ) {
      throw error;
    }
    const meta = await loadImageMeta(input, options);
    if (!meta) throw error;
    return {
      url: input,
      width: meta.width,
      height: meta.height,
      bytes: 0,
      mimeType: "",
    };
  }
  return storeImage(blob, options);
}

async function storeImage(blob: Blob, options: ImageReadOptions = {}) {
  const storageKey = `image:${nanoid()}`;
  const temporaryUrl = URL.createObjectURL(blob);
  try {
    const meta = await loadImageMeta(temporaryUrl, options);
    if (!meta) throw new Error(i18n.t("common.imageReadFailed"));
    throwIfAborted(options.signal);
    await imageStore.setItem(storageKey, blob);
    throwIfAborted(options.signal);
    objectUrls.adopt(storageKey, temporaryUrl);
    await storeImagePreview(storageKey, blob, options.signal);
    return {
      url: temporaryUrl,
      storageKey,
      width: meta.width,
      height: meta.height,
      bytes: blob.size,
      mimeType: blob.type.startsWith("image/") ? blob.type : "",
    } satisfies UploadedImage;
  } catch (error) {
    if (objectUrls.get(storageKey) === temporaryUrl) {
      objectUrls.invalidate(storageKey);
    } else {
      URL.revokeObjectURL(temporaryUrl);
    }
    await imageStore.removeItem(storageKey).catch(() => undefined);
    throw error;
  }
}

async function fetchImageBlob(url: string, options: ImageReadOptions = {}) {
  let timedOut = false;
  try {
    return await fetchBlobWithDeadline(withLocalProxy(url), {
      signal: options.signal,
      timeoutMs: options.timeoutMs ?? IMAGE_IO_TIMEOUT_MS,
      responseError: () => namedError(IMAGE_RESPONSE_ERROR),
      timeoutError: () => {
        timedOut = true;
        return namedError(IMAGE_TIMEOUT_ERROR);
      },
    });
  } catch (error) {
    if (timedOut) throw error;
    throw error;
  }
}

function loadImageMeta(
  url: string,
  options: ImageReadOptions = {},
  timeoutMs = IMAGE_DECODE_TIMEOUT_MS,
) {
  return new Promise<{ width: number; height: number } | null>(
    (resolve, reject) => {
      if (options.signal?.aborted) {
        reject(abortReason(options.signal));
        return;
      }
      const image = new Image();
      let settled = false;
      const finish = (result: { width: number; height: number } | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        image.onload = null;
        image.onerror = null;
        resolve(result);
      };
      const abort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        image.onload = null;
        image.onerror = null;
        reject(abortReason(options.signal!));
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      options.signal?.addEventListener("abort", abort, { once: true });
      image.onload = () =>
        finish(
          image.naturalWidth > 0 && image.naturalHeight > 0
            ? { width: image.naturalWidth, height: image.naturalHeight }
            : null,
        );
      image.onerror = () => finish(null);
      image.src = url;
    },
  );
}

function namedError(name: string) {
  const error = new Error(i18n.t("common.imageReadFailed"));
  error.name = name;
  return error;
}

function isNamedError(error: unknown, name: string) {
  return error instanceof Error && error.name === name;
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
  if (isServerAssetUrl(fallback)) return fallback;
  if (!storageKey) return fallback;
  return (
    (await objectUrls.resolve(storageKey, () =>
      imageStore.getItem<Blob>(storageKey),
    )) || fallback
  );
}

export async function getImageBlob(storageKey: string) {
  return imageStore.getItem<Blob>(storageKey);
}

export function previewUrlFor(storageKey?: string) {
  return storageKey ? previewUrls.get(storageKey) : undefined;
}

export function subscribeImagePreviews(listener: () => void) {
  previewListeners.add(listener);
  return () => previewListeners.delete(listener);
}

export function getImagePreviewRevision() {
  return previewRevision;
}

export async function ensureImagePreview(storageKey?: string) {
  if (!storageKey) return undefined;
  const cached = previewUrls.get(storageKey);
  if (cached) return cached;
  const stored = await previewStore
    .getItem<StoredImagePreview>(storageKey)
    .catch(() => null);
  if (stored?.version === IMAGE_PREVIEW_VERSION) {
    return stored.blob ? cacheImagePreview(storageKey, stored.blob) : undefined;
  }
  queueImagePreview(storageKey);
  return undefined;
}

function queueImagePreview(storageKey: string) {
  if (previewRequests.has(storageKey)) return previewRequests.get(storageKey);
  const request = previewQueue.then(async () => {
    const original = await getImageBlob(storageKey);
    if (original) await storeImagePreview(storageKey, original);
  });
  previewRequests.set(storageKey, request);
  previewQueue = request.catch(() => undefined);
  const release = () => {
    if (previewRequests.get(storageKey) === request) {
      previewRequests.delete(storageKey);
    }
  };
  request.then(release, release);
  return request;
}

async function storeImagePreview(
  storageKey: string,
  original: Blob,
  signal?: AbortSignal,
) {
  const generation = previewUrls.revision(storageKey);
  const preview = await createImageThumbnail(original).catch(() => undefined);
  throwIfAborted(signal);
  if (previewUrls.revision(storageKey) !== generation) return undefined;
  await previewStore
    .setItem<StoredImagePreview>(storageKey, {
      version: IMAGE_PREVIEW_VERSION,
      blob: preview,
    })
    .catch(() => undefined);
  if (previewUrls.revision(storageKey) !== generation) {
    await previewStore.removeItem(storageKey).catch(() => undefined);
    return undefined;
  }
  return preview ? cacheImagePreview(storageKey, preview) : undefined;
}

function cacheImagePreview(storageKey: string, preview: Blob) {
  const url = previewUrls.put(storageKey, preview);
  previewRevision += 1;
  previewListeners.forEach((listener) => listener());
  return url;
}

async function deleteImagePreview(storageKey: string) {
  previewUrls.invalidate(storageKey);
  await previewStore.removeItem(storageKey).catch(() => undefined);
}

export async function setImageBlob(storageKey: string, blob: Blob) {
  await imageStore.setItem(storageKey, blob);
  await deleteImagePreview(storageKey);
  const url = objectUrls.put(storageKey, blob);
  await storeImagePreview(storageKey, blob);
  return url;
}

export async function imageToDataUrl(
  image: { url?: string; dataUrl?: string; storageKey?: string },
  options: ImageReadOptions = {},
) {
  const url =
    image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
  if (!url || url.startsWith("data:")) return url;
  return blobToDataUrl(await fetchImageBlob(url, options), options.signal);
}

export async function deleteStoredImages(keys: Iterable<string>) {
  await Promise.all(
    Array.from(new Set(keys)).map(async (key) => {
      objectUrls.invalidate(key);
      await deleteImagePreview(key);
      await imageStore.removeItem(key);
    }),
  );
}

export async function cleanupUnusedImages(usedData: unknown) {
  const usedKeys = collectImageStorageKeys(usedData);
  await Promise.all([
    imageLogStore.iterate((value) => {
      collectImageStorageKeys(value, usedKeys);
    }),
    videoLogStore.iterate((value) => {
      collectImageStorageKeys(value, usedKeys);
    }),
  ]);
  const unused: string[] = [];
  await imageStore.iterate((_value, key) => {
    if (!usedKeys.has(key)) unused.push(key);
  });
  const orphanPreviews: string[] = [];
  await previewStore.iterate((_value, key) => {
    if (!usedKeys.has(key)) orphanPreviews.push(key);
  });
  await Promise.all([
    deleteStoredImages(unused),
    ...orphanPreviews.map(deleteImagePreview),
  ]);
}

export function collectImageStorageKeys(
  value: unknown,
  keys = new Set<string>(),
) {
  return collectStoredKeys(value, (key) => key.startsWith("image:"), keys);
}

function blobToDataUrl(blob: Blob, signal?: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const reader = new FileReader();
    const finish = (error?: Error) => {
      signal?.removeEventListener("abort", abort);
      reader.onload = null;
      reader.onerror = null;
      reader.onabort = null;
      if (error) reject(error);
      else resolve(String(reader.result || ""));
    };
    const abort = () => {
      reader.abort();
      finish(abortReason(signal!));
    };
    reader.onload = () => finish();
    reader.onerror = () => finish(new Error(i18n.t("common.imageReadFailed")));
    reader.onabort = () => finish(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    reader.readAsDataURL(blob);
  });
}
