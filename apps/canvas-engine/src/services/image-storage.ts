import { nanoid } from "nanoid";
import i18n from "@/i18n";
import { createScopedStorage } from "@/lib/localforage-storage";
import {
  downloadImageBlob,
  imageBlobToDataUrl,
  mayUseRemoteImage,
  readImageDimensions,
  type ImageReadOptions,
} from "./image-content";
import { ImagePreviewCache, ImageWriteLanes } from "./image-preview-cache";
import {
  collectStoredKeys,
  isServerAssetUrl,
  ObjectUrlRegistry,
  throwIfAborted,
} from "./media-storage-runtime";
import { collectStorageGarbage } from "./storage-garbage-collector";

export type UploadedImage = {
  url: string;
  storageKey?: string;
  width: number;
  height: number;
  bytes: number;
  mimeType: string;
};

// The mounted editor's immutable account/project scope owns every store and URL.
const originals = createScopedStorage("image_files");
const previewRecords = createScopedStorage("image_previews");
const imageHistory = createScopedStorage("image_generation_logs");
const videoHistory = createScopedStorage("video_generation_logs");
const writes = new ImageWriteLanes();
const originalUrls = new ObjectUrlRegistry();
const previews = new ImagePreviewCache(previewRecords, getImageBlob, writes);

export async function uploadImage(
  input: string | Blob,
  options: ImageReadOptions = {},
): Promise<UploadedImage> {
  throwIfAborted(options.signal);
  let blob: Blob;
  if (input instanceof Blob) blob = input;
  else {
    try {
      blob = await downloadImageBlob(input, options);
    } catch (error) {
      if (!mayUseRemoteImage(input, error, options.signal)) throw error;
      const size = await readImageDimensions(input, options.signal);
      if (!size) throw error;
      return { url: input, ...size, bytes: 0, mimeType: "" };
    }
  }
  return storeNewImage(blob, options);
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
  if (!storageKey || isServerAssetUrl(fallback)) return fallback;
  await writes.wait(storageKey);
  return (
    (await originalUrls.resolve(storageKey, () => getImageBlob(storageKey))) ||
    fallback
  );
}

export async function getImageBlob(storageKey: string) {
  await writes.wait(storageKey);
  return originals.getItem<Blob>(storageKey);
}

export const previewUrlFor = (storageKey?: string) => previews.get(storageKey);
export const subscribeImagePreviews = (listener: () => void) =>
  previews.subscribe(listener);
export const getImagePreviewRevision = () => previews.snapshot();
export const ensureImagePreview = (storageKey?: string) =>
  previews.ensure(storageKey);

export function setImageBlob(storageKey: string, blob: Blob): Promise<string> {
  const lifetime = previews.invalidate(storageKey);
  originalUrls.invalidate(storageKey);
  const saved = writes.run(storageKey, async () => {
    // Invalidate the durable preview first: memory-only invalidation cannot survive reloads.
    await previews.removeRecord(storageKey);
    await originals.setItem(storageKey, blob);
    const url = originalUrls.put(storageKey, blob);
    if (previews.lifetime(storageKey) !== lifetime)
      originalUrls.invalidate(storageKey);
    return url;
  });
  return saved.then(async (url) => {
    await previews.build(storageKey, blob, lifetime);
    return url;
  });
}

export async function imageToDataUrl(
  image: { url?: string; dataUrl?: string; storageKey?: string },
  options: ImageReadOptions = {},
) {
  throwIfAborted(options.signal);
  const source =
    image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
  if (!source || source.startsWith("data:")) return source;
  return imageBlobToDataUrl(
    await downloadImageBlob(source, options),
    options.signal,
  );
}

export function deleteStoredImages(keys: Iterable<string>) {
  const unique = [...new Set(keys)];
  // Invalidation happens at invocation, before any delayed reads can publish.
  for (const key of unique) {
    previews.invalidate(key);
    originalUrls.invalidate(key);
  }
  const deletions = unique.map((key) =>
    writes.run(key, async () => {
      await previews.removeRecord(key);
      await originals.removeItem(key);
      originalUrls.invalidate(key);
    }),
  );
  return Promise.all(deletions).then(() => undefined);
}

export async function cleanupUnusedImages(usedData: unknown) {
  await collectStorageGarbage({
    retained: collectImageStorageKeys(usedData),
    references: [imageHistory, videoHistory],
    collect: collectImageStorageKeys,
    stores: [
      { storage: originals, remove: (key) => deleteStoredImages([key]) },
      {
        storage: previewRecords,
        remove: (key) =>
          writes.run(key, async () => {
            previews.invalidate(key);
            await previews.removeRecord(key);
          }),
      },
    ],
  });
}

export function collectImageStorageKeys(
  value: unknown,
  keys = new Set<string>(),
) {
  return collectStoredKeys(value, (key) => key.startsWith("image:"), keys);
}

async function storeNewImage(
  blob: Blob,
  options: ImageReadOptions,
): Promise<UploadedImage> {
  const key = `image:${nanoid()}`;
  const url = URL.createObjectURL(blob);
  let adopted = false;
  const lifetime = previews.lifetime(key);
  try {
    const dimensions = await readImageDimensions(url, options.signal);
    if (!dimensions) throw new Error(i18n.t("common.imageReadFailed"));
    await writes.run(key, async () => {
      throwIfAborted(options.signal);
      await originals.setItem(key, blob);
      throwIfAborted(options.signal);
      originalUrls.adopt(key, url);
      adopted = true;
    });
    await previews.build(key, blob, lifetime, options.signal);
    throwIfAborted(options.signal);
    return {
      url,
      storageKey: key,
      ...dimensions,
      bytes: blob.size,
      mimeType: blob.type.startsWith("image/") ? blob.type : "",
    };
  } catch (error) {
    if (!adopted) URL.revokeObjectURL(url);
    await deleteStoredImages([key]).catch(() => undefined);
    throw error;
  }
}
