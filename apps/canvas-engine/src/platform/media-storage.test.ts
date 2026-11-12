import { afterEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  stores: new Map<string, Map<string, unknown>>(),
  reads: new Map<string, Promise<unknown>>(),
}));

vi.mock("@/lib/localforage-storage", () => ({
  createScopedStorage: (name: string) => {
    const store = harness.stores.get(name) || new Map<string, unknown>();
    harness.stores.set(name, store);
    return {
      getItem: async <T>(key: string) => {
        const delayed = harness.reads.get(`${name}/${key}`);
        return delayed ? await delayed as T : (store.get(key) as T) ?? null;
      },
      setItem: async <T>(key: string, value: T) => {
        store.set(key, value);
        return value;
      },
      removeItem: async (key: string) => void store.delete(key),
      clear: async () => void store.clear(),
      iterate: async <T>(iterator: (value: T, key: string) => unknown) => {
        for (const [key, value] of store) iterator(value as T, key);
      },
    };
  },
}));

vi.mock("@/stores/use-config-store", () => ({
  withLocalProxy: (url: string) => url,
}));

vi.mock("@/i18n", () => ({
  default: { t: (key: string) => key },
}));

vi.mock("@/lib/image-thumbnail", () => ({
  createImageThumbnail: async () =>
    new Blob(["preview"], { type: "image/webp" }),
}));

import {
  deleteStoredMedia,
  resolveMediaUrl,
  setMediaBlob,
} from "@/services/file-storage";
import {
  deleteStoredImages,
  ensureImagePreview,
  getImagePreviewRevision,
  previewUrlFor,
  subscribeImagePreviews,
  setImageBlob,
  uploadImage,
} from "@/services/image-storage";

afterEach(() => {
  for (const store of harness.stores.values()) store.clear();
  harness.reads.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("media storage services", () => {
  it("replaces cached media URLs and releases them when their storage keys are deleted", async () => {
    const createUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:media-old")
      .mockReturnValueOnce("blob:media-new");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const first = await setMediaBlob("video:stable", new Blob(["old"]));
    const second = await setMediaBlob("video:stable", new Blob(["new"]));

    expect(first).toBe("blob:media-old");
    expect(second).toBe("blob:media-new");
    expect(revoke).toHaveBeenCalledWith(first);
    expect(await resolveMediaUrl("video:stable")).toBe(second);

    await deleteStoredMedia(["video:stable"]);
    expect(revoke).toHaveBeenCalledWith(second);
    expect(await resolveMediaUrl("video:stable", "/missing")).toBe("/missing");
    expect(createUrl).toHaveBeenCalledTimes(2);
  });

  it("releases both original and thumbnail URLs when an image is deleted", async () => {
    vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:image")
      .mockReturnValueOnce("blob:preview");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    class FakeImage {
      naturalWidth = 640;
      naturalHeight = 480;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_url: string) {
        this.onload?.();
      }
    }
    vi.stubGlobal("Image", FakeImage);

    const image = await uploadImage(
      new Blob(["pixels"], { type: "image/png" }),
    );
    const previewChanged = vi.fn();
    const unsubscribe = subscribeImagePreviews(previewChanged);
    expect(image.storageKey).toMatch(/^image:/);
    expect(previewUrlFor(image.storageKey)).toBe("blob:preview");
    expect(getImagePreviewRevision()).toBe(1);

    await deleteStoredImages([image.storageKey!]);
    unsubscribe();
    expect(revoke).toHaveBeenCalledWith("blob:image");
    expect(revoke).toHaveBeenCalledWith("blob:preview");
    expect(previewUrlFor(image.storageKey)).toBeUndefined();
    expect(previewChanged).toHaveBeenCalledTimes(1);
    expect(getImagePreviewRevision()).toBe(2);
  });

  it("replaces image bytes under an existing key without retaining stale previews", async () => {
    vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:old-image")
      .mockReturnValueOnce("blob:old-preview")
      .mockReturnValueOnce("blob:new-image")
      .mockReturnValueOnce("blob:new-preview");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const key = "image:shared";
    await setImageBlob(key, new Blob(["old"]));
    await setImageBlob(key, new Blob(["new"]));

    expect(revoke).toHaveBeenCalledWith("blob:old-image");
    expect(revoke).toHaveBeenCalledWith("blob:old-preview");
    expect(previewUrlFor(key)).toBe("blob:new-preview");
  });

  it("aborts remote media download and clears its deadline timer", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    const { uploadMediaFile } = await import("@/services/file-storage");
    const controller = new AbortController();
    const upload = uploadMediaFile("https://cdn.example/media.mp4", "video", {
      signal: controller.signal,
    });
    controller.abort();

    await expect(upload).rejects.toMatchObject({ name: "AbortError" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("captures media metadata before releasing the temporary source", async () => {
    const mediaElement = {
      videoWidth: 1920,
      videoHeight: 1080,
      duration: 4.25,
      preload: "",
      onloadedmetadata: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      src: "",
      removeAttribute: vi.fn(),
      load: vi.fn(() => {
        Object.defineProperties(mediaElement, {
          videoWidth: { configurable: true, value: 0 },
          videoHeight: { configurable: true, value: 0 },
          duration: { configurable: true, value: Number.NaN },
        });
      }),
    } as unknown as HTMLVideoElement;
    vi.stubGlobal("document", {
      createElement: vi.fn(() => mediaElement),
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:video");

    const { uploadMediaFile } = await import("@/services/file-storage");
    const upload = uploadMediaFile(
      new Blob(["video"], { type: "video/mp4" }),
      "video",
    );
    await Promise.resolve();
    mediaElement.onloadedmetadata?.(new Event("loadedmetadata"));

    await expect(upload).resolves.toMatchObject({
      width: 1920,
      height: 1080,
      durationMs: 4250,
    });
  });

  it("shares thumbnail reads and ignores an earlier response after deletion", async () => {
    let resolve!: (record: unknown) => void;
    harness.reads.set("image_previews/image:retired", new Promise((done) => { resolve = done; }));
    const create = vi.spyOn(URL, "createObjectURL");
    const first = ensureImagePreview("image:retired");
    const duplicate = ensureImagePreview("image:retired");
    expect(duplicate).toBe(first);

    await deleteStoredImages(["image:retired"]);
    resolve({ version: 1, blob: new Blob(["old preview"]) });
    await expect(first).resolves.toBeUndefined();
    expect(create).not.toHaveBeenCalled();
    expect(previewUrlFor("image:retired")).toBeUndefined();
  });

  it("keeps image references held by generation logs while removing abandoned files", async () => {
    const { cleanupUnusedImages } = await import("@/services/image-storage");
    const originals = harness.stores.get("image_files")!;
    const previews = harness.stores.get("image_previews")!;
    for (const key of ["image:project", "image:history", "image:unused"]) {
      originals.set(key, new Blob([key]));
      previews.set(key, { version: 1, blob: new Blob([key]) });
    }
    harness.stores.get("video_generation_logs")!.set("run", { references: [{ storageKey: "image:history" }] });
    await cleanupUnusedImages({ storageKey: "image:project" });
    expect([...originals.keys()].sort()).toEqual(["image:history", "image:project"]);
    expect([...previews.keys()].sort()).toEqual(["image:history", "image:project"]);
  });
});
