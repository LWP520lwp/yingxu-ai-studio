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
import { collectStorageGarbage } from "./storage-garbage-collector";

export type UploadedImage = {
  url: string;
  storageKey?: string;
  width: number;
  height: number;
  bytes: number;
  mimeType: string;
};

type ReadOptions = { signal?: AbortSignal; timeoutMs?: number };
type PreviewRecord = { version: number; blob?: Blob };
type Dimensions = { width: number; height: number };

const IMAGE_PREVIEW_VERSION = 1;
const IMAGE_FETCH_LIMIT_MS = 10 * 60_000;
const IMAGE_DECODE_LIMIT_MS = 10_000;
const ERROR_RESPONSE = "ImageResponseError";
const ERROR_DEADLINE = "ImageTimeoutError";

const originals = createScopedStorage("image_files");
const previews = createScopedStorage("image_previews");
const imageHistory = createScopedStorage("image_generation_logs");
const videoHistory = createScopedStorage("video_generation_logs");

class ImageRepository {
  private readonly originalUrls = new ObjectUrlRegistry();
  private readonly thumbnailUrls = new ObjectUrlRegistry();
  private readonly listeners = new Set<() => void>();
  private readonly previewReads = new Map<string, Promise<string | undefined>>();
  private readonly previewJobs = new Map<string, Promise<void>>();
  private previewWrites: Promise<void> = Promise.resolve();
  private revision = 0;

  async upload(input: string | Blob, options: ReadOptions = {}): Promise<UploadedImage> {
    throwIfAborted(options.signal);
    if (input instanceof Blob) return this.save(input, options);

    try {
      const downloaded = await this.download(input, options);
      return await this.save(downloaded, options);
    } catch (error) {
      const cannotUseRemoteFallback =
        options.signal?.aborted ||
        this.isNamedFailure(error, ERROR_RESPONSE) ||
        this.isNamedFailure(error, ERROR_DEADLINE) ||
        !/^https?:\/\//i.test(input);
      if (cannotUseRemoteFallback) throw error;

      const dimensions = await this.readDimensions(input, options);
      if (!dimensions) throw error;
      return {
        url: input,
        ...dimensions,
        bytes: 0,
        mimeType: "",
      };
    }
  }

  resolveUrl(storageKey?: string, fallback = "") {
    if (isServerAssetUrl(fallback) || !storageKey) return Promise.resolve(fallback);
    return this.originalUrls.resolve(storageKey, () => originals.getItem<Blob>(storageKey)).then(
      (url) => url || fallback,
    );
  }

  readBlob(storageKey: string) {
    return originals.getItem<Blob>(storageKey);
  }

  async replace(storageKey: string, blob: Blob) {
    await originals.setItem(storageKey, blob);
    await this.removePreview(storageKey);
    const url = this.originalUrls.put(storageKey, blob);
    await this.writePreview(storageKey, blob);
    return url;
  }

  getPreviewUrl(storageKey?: string) {
    return storageKey ? this.thumbnailUrls.get(storageKey) : undefined;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getRevision() {
    return this.revision;
  }

  preview(storageKey?: string): Promise<string | undefined> {
    if (!storageKey) return Promise.resolve(undefined);
    const cachedUrl = this.thumbnailUrls.get(storageKey);
    if (cachedUrl) return Promise.resolve(cachedUrl);

    const activeRead = this.previewReads.get(storageKey);
    if (activeRead) return activeRead;

    const readRevision = this.thumbnailUrls.revision(storageKey);
    const read = previews
      .getItem<PreviewRecord>(storageKey)
      .catch(() => null)
      .then((record) => {
        if (this.thumbnailUrls.revision(storageKey) !== readRevision) {
          return this.thumbnailUrls.get(storageKey);
        }
        if (record?.version === IMAGE_PREVIEW_VERSION) {
          return record.blob ? this.cachePreview(storageKey, record.blob) : undefined;
        }
        void this.regeneratePreview(storageKey).catch(() => undefined);
        return undefined;
      });

    this.previewReads.set(storageKey, read);
    const release = () => {
      if (this.previewReads.get(storageKey) === read) this.previewReads.delete(storageKey);
    };
    void read.then(release, release);
    return read;
  }

  async dataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }, options: ReadOptions = {}) {
    const source = image.dataUrl || (await this.resolveUrl(image.storageKey, image.url || ""));
    if (!source || source.startsWith("data:")) return source;
    return this.toDataUrl(await this.download(source, options), options.signal);
  }

  async removeMany(keys: Iterable<string>) {
    await Promise.all(
      [...new Set(keys)].map(async (key) => {
        this.originalUrls.invalidate(key);
        await this.removePreview(key);
        await originals.removeItem(key);
      }),
    );
  }

  async removeOrphans(data: unknown) {
    await collectStorageGarbage({
      retained: collectImageStorageKeys(data),
      references: [imageHistory, videoHistory],
      collect: collectImageStorageKeys,
      stores: [
        { storage: originals, remove: (key) => this.removeMany([key]) },
        { storage: previews, remove: (key) => this.removePreview(key) },
      ],
    });
  }

  collectKeys(value: unknown, keys = new Set<string>()) {
    return collectStoredKeys(value, (key) => key.startsWith("image:"), keys);
  }

  private async save(blob: Blob, options: ReadOptions): Promise<UploadedImage> {
    const key = `image:${nanoid()}`;
    const temporaryUrl = URL.createObjectURL(blob);
    let attached = false;

    try {
      const dimensions = await this.readDimensions(temporaryUrl, options);
      if (!dimensions) throw new Error(i18n.t("common.imageReadFailed"));
      throwIfAborted(options.signal);
      await originals.setItem(key, blob);
      throwIfAborted(options.signal);
      this.originalUrls.adopt(key, temporaryUrl);
      attached = true;
      await this.writePreview(key, blob, options.signal);

      return {
        url: temporaryUrl,
        storageKey: key,
        ...dimensions,
        bytes: blob.size,
        mimeType: blob.type.startsWith("image/") ? blob.type : "",
      };
    } catch (error) {
      if (attached) this.originalUrls.invalidate(key);
      else URL.revokeObjectURL(temporaryUrl);
      await originals.removeItem(key).catch(() => undefined);
      throw error;
    }
  }

  private download(url: string, options: ReadOptions) {
    return fetchBlobWithDeadline(withLocalProxy(url), {
      signal: options.signal,
      timeoutMs: options.timeoutMs ?? IMAGE_FETCH_LIMIT_MS,
      responseError: () => this.imageFailure(ERROR_RESPONSE),
      timeoutError: () => this.imageFailure(ERROR_DEADLINE),
    });
  }

  private readDimensions(url: string, options: ReadOptions, timeoutMs = IMAGE_DECODE_LIMIT_MS) {
    return new Promise<Dimensions | null>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(abortReason(options.signal));
        return;
      }

      const image = new Image();
      let completed = false;
      const finish = (result: Dimensions | null, error?: Error) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        image.onload = null;
        image.onerror = null;
        if (error) reject(error);
        else resolve(result);
      };
      const onAbort = () => finish(null, abortReason(options.signal!));
      const timer = setTimeout(() => finish(null), timeoutMs);

      options.signal?.addEventListener("abort", onAbort, { once: true });
      image.onload = () => {
        const width = image.naturalWidth;
        const height = image.naturalHeight;
        finish(width > 0 && height > 0 ? { width, height } : null);
      };
      image.onerror = () => finish(null);
      image.src = url;
    });
  }

  private regeneratePreview(storageKey: string) {
    const existing = this.previewJobs.get(storageKey);
    if (existing) return existing;

    const revision = this.thumbnailUrls.revision(storageKey);
    const job = (async () => {
      if (this.thumbnailUrls.revision(storageKey) !== revision) return;
      const source = await this.readBlob(storageKey);
      if (!source || this.thumbnailUrls.revision(storageKey) !== revision) return;
      await this.writePreview(storageKey, source);
    })();

    this.previewJobs.set(storageKey, job);
    this.previewWrites = job.catch(() => undefined);
    const release = () => {
      if (this.previewJobs.get(storageKey) === job) this.previewJobs.delete(storageKey);
    };
    void job.then(release, release);
    return job;
  }

  private writePreview(storageKey: string, source: Blob, signal?: AbortSignal) {
    const expectedRevision = this.thumbnailUrls.revision(storageKey);
    const write = this.previewWrites.then(async () => {
      if (this.thumbnailUrls.revision(storageKey) !== expectedRevision) return;
      const thumbnail = await createImageThumbnail(source).catch(() => undefined);
      throwIfAborted(signal);
      if (this.thumbnailUrls.revision(storageKey) !== expectedRevision) return;

      const record: PreviewRecord = { version: IMAGE_PREVIEW_VERSION, blob: thumbnail };
      await previews.setItem(storageKey, record).catch(() => undefined);
      if (this.thumbnailUrls.revision(storageKey) !== expectedRevision) {
        await previews.removeItem(storageKey).catch(() => undefined);
        return;
      }
      if (thumbnail) this.cachePreview(storageKey, thumbnail);
    });

    this.previewWrites = write.catch(() => undefined);
    return write;
  }

  private cachePreview(storageKey: string, blob: Blob) {
    const url = this.thumbnailUrls.put(storageKey, blob);
    this.publishPreviewChange();
    return url;
  }

  private async removePreview(storageKey: string) {
    const wasVisible = Boolean(this.thumbnailUrls.get(storageKey));
    this.thumbnailUrls.invalidate(storageKey);
    this.previewReads.delete(storageKey);
    await previews.removeItem(storageKey).catch(() => undefined);
    if (wasVisible) this.publishPreviewChange();
  }

  private publishPreviewChange() {
    this.revision += 1;
    for (const listener of [...this.listeners]) listener();
  }

  private toDataUrl(blob: Blob, signal?: AbortSignal) {
    return new Promise<string>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortReason(signal));
        return;
      }

      const reader = new FileReader();
      let completed = false;
      const finish = (error?: Error) => {
        if (completed) return;
        completed = true;
        signal?.removeEventListener("abort", onAbort);
        reader.onload = null;
        reader.onerror = null;
        reader.onabort = null;
        if (error) reject(error);
        else resolve(String(reader.result || ""));
      };
      const onAbort = () => {
        finish(abortReason(signal!));
        reader.abort();
      };

      reader.onload = () => finish();
      reader.onerror = () => finish(new Error(i18n.t("common.imageReadFailed")));
      reader.onabort = () => finish(new DOMException("Aborted", "AbortError"));
      signal?.addEventListener("abort", onAbort, { once: true });
      reader.readAsDataURL(blob);
    });
  }

  private imageFailure(name: string) {
    const error = new Error(i18n.t("common.imageReadFailed"));
    error.name = name;
    return error;
  }

  private isNamedFailure(error: unknown, name: string) {
    return error instanceof Error && error.name === name;
  }
}

const repository = new ImageRepository();

export const uploadImage = (input: string | Blob, options: ReadOptions = {}) =>
  repository.upload(input, options);

export const resolveImageUrl = (storageKey?: string, fallback = "") =>
  repository.resolveUrl(storageKey, fallback);

export const getImageBlob = (storageKey: string) => repository.readBlob(storageKey);

export const previewUrlFor = (storageKey?: string) => repository.getPreviewUrl(storageKey);

export const subscribeImagePreviews = (listener: () => void) => repository.subscribe(listener);

export const getImagePreviewRevision = () => repository.getRevision();

export const ensureImagePreview = (storageKey?: string) => repository.preview(storageKey);

export const setImageBlob = (storageKey: string, blob: Blob) => repository.replace(storageKey, blob);

export const imageToDataUrl = (
  image: { url?: string; dataUrl?: string; storageKey?: string },
  options: ReadOptions = {},
) => repository.dataUrl(image, options);

export const deleteStoredImages = (keys: Iterable<string>) => repository.removeMany(keys);

export const cleanupUnusedImages = (usedData: unknown) => repository.removeOrphans(usedData);

export const collectImageStorageKeys = (value: unknown, keys = new Set<string>()) =>
  repository.collectKeys(value, keys);
