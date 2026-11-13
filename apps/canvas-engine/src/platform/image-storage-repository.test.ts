import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
  tables: new Map<string, Map<string, unknown>>(),
  reads: new Map<string, () => Promise<unknown>>(),
  writes: new Map<string, (value: unknown) => Promise<unknown>>(),
  removes: new Map<string, () => Promise<unknown>>(),
  thumbnail: vi.fn<(source: Blob) => Promise<Blob | undefined>>(),
  proxy: vi.fn<(source: string) => string>(),
}));

vi.mock("localforage", () => ({
  default: {
    createInstance: ({
      name,
      storeName,
    }: {
      name: string;
      storeName: string;
    }) => {
      const identity = `${name}/${storeName}`;
      let values = backend.tables.get(identity);
      if (!values) {
        values = new Map();
        backend.tables.set(identity, values);
      }
      const table = values;
      return {
        getItem: async (key: string) =>
          backend.reads.get(`${identity}/${key}`)?.() ?? table.get(key) ?? null,
        setItem: async (key: string, value: unknown) => {
          await backend.writes.get(`${identity}/${key}`)?.(value);
          table.set(key, value);
          return value;
        },
        removeItem: async (key: string) => {
          await backend.removes.get(`${identity}/${key}`)?.();
          table.delete(key);
        },
        iterate: async (visit: (value: unknown, key: string) => void) => {
          for (const [key, value] of table) visit(value, key);
        },
      };
    },
  },
}));
vi.mock("@/lib/image-thumbnail", () => ({
  createImageThumbnail: backend.thumbnail,
}));
vi.mock("@/stores/use-config-store", () => ({ withLocalProxy: backend.proxy }));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const tableName = (store: string, user = "reviewer", project = "canvas") =>
  `yingxu-atlas-canvas:${encodeURIComponent(user)}:${encodeURIComponent(project)}/${store}`;
const address = (store: string, key: string) => `${tableName(store)}/${key}`;
function table(store: string, user = "reviewer", project = "canvas") {
  const identity = tableName(store, user, project);
  let values = backend.tables.get(identity);
  if (!values) {
    values = new Map();
    backend.tables.set(identity, values);
  }
  return values;
}

async function load(user = "reviewer", project = "canvas") {
  vi.resetModules();
  const scope = await import("@/lib/localforage-storage");
  scope.configureStorageScope(user, project);
  return import("@/services/image-storage");
}

beforeEach(() => {
  backend.tables.clear();
  backend.reads.clear();
  backend.writes.clear();
  backend.removes.clear();
  backend.thumbnail
    .mockReset()
    .mockImplementation(
      async () => new Blob(["thumbnail"], { type: "image/webp" }),
    );
  backend.proxy.mockReset().mockImplementation((source) => source);
  let nextUrl = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(
    () => `blob:image-test-${++nextUrl}`,
  );
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = 1280;
      naturalHeight = 720;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_source: string) {
        this.onload?.();
      }
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("image repository through the scoped persistence API", () => {
  it("finishes missing and outdated preview generation while preserving compatible records", async () => {
    for (const key of [
      "image:missing",
      "image:outdated",
      "image:valid",
      "image:small",
    ]) {
      table("image_files").set(key, new Blob([key]));
    }
    table("image_previews").set("image:outdated", {
      version: 0,
      blob: new Blob(["old"]),
    });
    table("image_previews").set("image:valid", {
      version: 1,
      blob: new Blob(["valid"]),
    });
    table("image_previews").set("image:small", { version: 1 });
    const images = await load();
    const missing = images.ensureImagePreview("image:missing");
    expect(images.ensureImagePreview("image:missing")).toBe(missing);
    await Promise.all([missing, images.ensureImagePreview("image:outdated")]);
    expect(await images.ensureImagePreview("image:valid")).toMatch(/^blob:/);
    expect(await images.ensureImagePreview("image:small")).toBeUndefined();
    await vi.waitFor(() => {
      expect(images.previewUrlFor("image:missing")).toMatch(/^blob:/);
      expect(images.previewUrlFor("image:outdated")).toMatch(/^blob:/);
    });
    expect(backend.thumbnail).toHaveBeenCalledTimes(2);
    expect(table("image_previews").get("image:missing")).toMatchObject({
      version: 1,
      blob: expect.any(Blob),
    });
  });

  it("shares four generation slots across uploads, replacements and restored previews", async () => {
    let active = 0;
    let peak = 0;
    const gates: Array<ReturnType<typeof deferred<void>>> = [];
    backend.thumbnail.mockImplementation(async () => {
      const gate = deferred();
      gates.push(gate);
      active += 1;
      peak = Math.max(peak, active);
      await gate.promise;
      active -= 1;
      return new Blob(["preview"]);
    });
    for (let index = 0; index < 6; index += 1) {
      table("image_files").set(
        `image:restore-${index}`,
        new Blob(["original"]),
      );
    }
    const images = await load();
    const restored = Array.from({ length: 6 }, (_, index) =>
      images.ensureImagePreview(`image:restore-${index}`),
    );
    const replacements = Array.from({ length: 3 }, (_, index) =>
      images.setImageBlob(`image:replace-${index}`, new Blob(["new"])),
    );
    const uploads = Array.from({ length: 3 }, () =>
      images.uploadImage(new Blob(["upload"], { type: "image/png" })),
    );
    await Promise.all(restored);
    await vi.waitFor(() => expect(gates).toHaveLength(4));
    expect(active).toBe(4);
    for (let index = 0; index < 12; index += 1) {
      await vi.waitFor(() => expect(gates.length).toBeGreaterThan(index));
      gates[index].resolve();
    }
    await Promise.all([...replacements, ...uploads]);
    await vi.waitFor(() => expect(table("image_previews").size).toBe(12));
    expect(peak).toBe(4);
    expect(active).toBe(0);
  });

  it("retries failed encoding and preview persistence without rolling back saved originals", async () => {
    const images = await load();
    backend.thumbnail.mockRejectedValueOnce(new Error("encoder unavailable"));
    await images.setImageBlob("image:encoding", new Blob(["first"]));
    expect(await images.getImageBlob("image:encoding")).toBeInstanceOf(Blob);
    expect(table("image_previews").has("image:encoding")).toBe(false);
    await images.ensureImagePreview("image:encoding");
    await vi.waitFor(() =>
      expect(images.previewUrlFor("image:encoding")).toMatch(/^blob:/),
    );
    let fail = true;
    backend.writes.set(address("image_previews", "image:disk"), async () => {
      if (fail) throw new Error("preview disk full");
    });
    await images.setImageBlob("image:disk", new Blob(["second"]));
    expect(images.previewUrlFor("image:disk")).toBeUndefined();
    fail = false;
    await images.ensureImagePreview("image:disk");
    await vi.waitFor(() =>
      expect(images.previewUrlFor("image:disk")).toMatch(/^blob:/),
    );
    expect(backend.thumbnail).toHaveBeenCalledTimes(4);
  });

  it("isolates subscriber failures from successful uploads and other subscribers", async () => {
    const images = await load();
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const notified = vi.fn();
    images.subscribeImagePreviews(() => {
      throw new Error("broken view");
    });
    images.subscribeImagePreviews(notified);
    const result = await images.uploadImage(
      new Blob(["image"], { type: "image/png" }),
    );
    expect(result).toMatchObject({
      width: 1280,
      height: 720,
      bytes: 5,
      mimeType: "image/png",
    });
    expect(await images.getImageBlob(result.storageKey!)).toBeInstanceOf(Blob);
    expect(notified).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledOnce();
  });

  it("deletes during generation without waiting for or resurrecting the old thumbnail", async () => {
    const gate = deferred<Blob>();
    backend.thumbnail.mockReturnValueOnce(gate.promise);
    const images = await load();
    const saving = images.setImageBlob("image:deleted", new Blob(["old"]));
    await vi.waitFor(() => expect(backend.thumbnail).toHaveBeenCalledOnce());
    await images.deleteStoredImages(["image:deleted"]);
    gate.resolve(new Blob(["stale thumbnail"]));
    await saving;
    expect(await images.getImageBlob("image:deleted")).toBeNull();
    expect(await images.resolveImageUrl("image:deleted", "missing")).toBe(
      "missing",
    );
    expect(images.previewUrlFor("image:deleted")).toBeUndefined();
    expect(table("image_previews").has("image:deleted")).toBe(false);
  });

  it("ignores an old preview read after replacement and keeps the new cached URL", async () => {
    const stale = deferred<unknown>();
    const reading = deferred();
    backend.reads.set(address("image_previews", "image:replaced"), () => {
      reading.resolve();
      return stale.promise;
    });
    const images = await load();
    const before = images.ensureImagePreview("image:replaced");
    await reading.promise;
    const originalUrl = await images.setImageBlob(
      "image:replaced",
      new Blob(["new image"]),
    );
    const previewUrl = images.previewUrlFor("image:replaced");
    stale.resolve({ version: 1, blob: new Blob(["stale preview"]) });
    expect(await before).toBe(previewUrl);
    expect(await images.resolveImageUrl("image:replaced")).toBe(originalUrl);
    expect(images.previewUrlFor("image:replaced")).toBe(previewUrl);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
  });

  it("orders delayed replacement, deletion and a final replacement by invocation", async () => {
    const firstWrite = deferred();
    const started = deferred();
    let count = 0;
    backend.writes.set(address("image_files", "image:ordered"), async () => {
      if (count++ === 0) {
        started.resolve();
        await firstWrite.promise;
      }
    });
    const images = await load();
    const first = images.setImageBlob("image:ordered", new Blob(["old"]));
    await started.promise;
    const remove = images.deleteStoredImages(["image:ordered"]);
    const last = images.setImageBlob("image:ordered", new Blob(["latest"]));
    const read = images.getImageBlob("image:ordered");
    firstWrite.resolve();
    await Promise.all([first, remove, last]);
    expect(await (await read)!.text()).toBe("latest");
    expect(await (await images.getImageBlob("image:ordered"))!.text()).toBe(
      "latest",
    );
    expect(images.previewUrlFor("image:ordered")).toMatch(/^blob:/);
    expect(backend.thumbnail).toHaveBeenCalledOnce();
  });

  it("does not retain a late original URL after a queued deletion", async () => {
    const gate = deferred();
    const started = deferred();
    backend.writes.set(
      address("image_files", "image:queued-delete"),
      async () => {
        started.resolve();
        await gate.promise;
      },
    );
    const images = await load();
    const writing = images.setImageBlob(
      "image:queued-delete",
      new Blob(["old"]),
    );
    await started.promise;
    const deleting = images.deleteStoredImages(["image:queued-delete"]);
    gate.resolve();
    await Promise.all([writing, deleting]);
    expect(await images.resolveImageUrl("image:queued-delete", "gone")).toBe(
      "gone",
    );
    expect(table("image_files").has("image:queued-delete")).toBe(false);
    expect(images.previewUrlFor("image:queued-delete")).toBeUndefined();
  });

  it("finishes an old preview write before persisting a newer replacement", async () => {
    const blocked = deferred();
    const started = deferred();
    let writes = 0;
    backend.writes.set(address("image_previews", "image:commit"), async () => {
      if (writes++ === 0) {
        started.resolve();
        await blocked.promise;
      }
    });
    const images = await load();
    const old = images.setImageBlob("image:commit", new Blob(["old"]));
    await started.promise;
    const latest = images.setImageBlob("image:commit", new Blob(["latest"]));
    blocked.resolve();
    await Promise.all([old, latest]);
    expect(await (await images.getImageBlob("image:commit"))!.text()).toBe(
      "latest",
    );
    expect(table("image_previews").get("image:commit")).toMatchObject({
      version: 1,
      blob: expect.any(Blob),
    });
    expect(images.previewUrlFor("image:commit")).toMatch(/^blob:/);
  });

  it("keeps durable images across reloads while isolating other accounts and projects", async () => {
    const original = await load("owner", "one");
    const saved = await original.uploadImage(
      new Blob(["private"], { type: "image/png" }),
    );
    const reloaded = await load("owner", "one");
    expect(await (await reloaded.getImageBlob(saved.storageKey!))!.text()).toBe(
      "private",
    );
    expect(await reloaded.resolveImageUrl(saved.storageKey)).not.toBe(
      saved.url,
    );
    expect(await reloaded.ensureImagePreview(saved.storageKey)).toMatch(
      /^blob:/,
    );
    expect(backend.thumbnail).toHaveBeenCalledOnce();
    const anotherUser = await load("another", "one");
    expect(await anotherUser.getImageBlob(saved.storageKey!)).toBeNull();
    expect(await anotherUser.resolveImageUrl(saved.storageKey, "missing")).toBe(
      "missing",
    );
    const anotherProject = await load("owner", "two");
    expect(await anotherProject.getImageBlob(saved.storageKey!)).toBeNull();
    expect(
      await anotherProject.ensureImagePreview(saved.storageKey),
    ).toBeUndefined();
    expect(anotherProject.previewUrlFor(saved.storageKey)).toBeUndefined();
    const scope = await import("@/lib/localforage-storage");
    expect(() => scope.configureStorageScope("owner", "one")).toThrow(
      "切换项目",
    );
  });

  it("recovers the same write lane after original persistence rejects", async () => {
    let fail = true;
    backend.writes.set(address("image_files", "image:retry"), async () => {
      if (fail) throw new Error("original disk full");
    });
    const images = await load();
    await expect(
      images.setImageBlob("image:retry", new Blob(["lost"])),
    ).rejects.toThrow("original disk full");
    fail = false;
    const url = await images.setImageBlob("image:retry", new Blob(["saved"]));
    expect(await images.resolveImageUrl("image:retry")).toBe(url);
    expect(await (await images.getImageBlob("image:retry"))!.text()).toBe(
      "saved",
    );
  });

  it("rejects replacement before changing the original when durable preview invalidation fails", async () => {
    backend.thumbnail.mockImplementation(
      async (source) => new Blob([`preview:${await source.text()}`]),
    );
    const images = await load();
    await images.setImageBlob("image:invalidation", new Blob(["old"]));
    backend.removes.set(
      address("image_previews", "image:invalidation"),
      async () => {
        throw new Error("preview invalidation failed");
      },
    );
    await expect(
      images.setImageBlob("image:invalidation", new Blob(["new"])),
    ).rejects.toThrow("preview invalidation failed");
    expect(
      await (await images.getImageBlob("image:invalidation"))!.text(),
    ).toBe("old");
    expect(backend.thumbnail).toHaveBeenCalledOnce();

    const reloaded = await load();
    expect(await reloaded.ensureImagePreview("image:invalidation")).toMatch(
      /^blob:/,
    );
    const persisted = table("image_previews").get("image:invalidation") as {
      blob: Blob;
    };
    expect(await persisted.blob.text()).toBe("preview:old");
    expect(
      await (await reloaded.getImageBlob("image:invalidation"))!.text(),
    ).toBe("old");

    backend.removes.delete(address("image_previews", "image:invalidation"));
    await reloaded.setImageBlob("image:invalidation", new Blob(["retried"]));
    expect(
      await (await reloaded.getImageBlob("image:invalidation"))!.text(),
    ).toBe("retried");
  });

  it("reports deletion failure and preserves the original and matching preview across reloads", async () => {
    const images = await load();
    await images.setImageBlob("image:delete-failure", new Blob(["preserved"]));
    backend.removes.set(
      address("image_previews", "image:delete-failure"),
      async () => {
        throw new Error("preview deletion failed");
      },
    );
    await expect(
      images.deleteStoredImages(["image:delete-failure"]),
    ).rejects.toThrow("preview deletion failed");
    const reloaded = await load();
    expect(
      await (await reloaded.getImageBlob("image:delete-failure"))!.text(),
    ).toBe("preserved");
    expect(await reloaded.ensureImagePreview("image:delete-failure")).toMatch(
      /^blob:/,
    );

    backend.removes.delete(address("image_previews", "image:delete-failure"));
    await reloaded.deleteStoredImages(["image:delete-failure"]);
    const deleted = await load();
    expect(await deleted.getImageBlob("image:delete-failure")).toBeNull();
    expect(
      await deleted.ensureImagePreview("image:delete-failure"),
    ).toBeUndefined();
    expect(deleted.previewUrlFor("image:delete-failure")).toBeUndefined();
    expect(table("image_previews").has("image:delete-failure")).toBe(false);
  });

  it.each(["encoding", "persistence"] as const)(
    "never restores an obsolete preview after replacement and %s failure followed by reload",
    async (failure) => {
      backend.thumbnail.mockImplementation(
        async (source) => new Blob([`preview:${await source.text()}`]),
      );
      const images = await load();
      const key = `image:reload-${failure}`;
      await images.setImageBlob(key, new Blob(["old"]));
      if (failure === "encoding") {
        backend.thumbnail.mockRejectedValueOnce(
          new Error("encoding unavailable"),
        );
      } else {
        backend.writes.set(address("image_previews", key), async () => {
          throw new Error("preview persistence unavailable");
        });
      }
      await images.setImageBlob(key, new Blob(["new"]));
      expect(await (await images.getImageBlob(key))!.text()).toBe("new");
      expect(table("image_previews").has(key)).toBe(false);
      backend.writes.delete(address("image_previews", key));

      const reloaded = await load();
      expect(await reloaded.ensureImagePreview(key)).toBeUndefined();
      await vi.waitFor(() =>
        expect(reloaded.previewUrlFor(key)).toMatch(/^blob:/),
      );
      const persisted = table("image_previews").get(key) as {
        version: number;
        blob: Blob;
      };
      expect(persisted.version).toBe(1);
      expect(await persisted.blob.text()).toBe("preview:new");
      expect(backend.thumbnail).toHaveBeenCalledTimes(3);
    },
  );
});

describe("image content through the public service", () => {
  it("downloads through the configured proxy and preserves original metadata", async () => {
    backend.proxy.mockImplementation(
      (source) => `/proxy?url=${encodeURIComponent(source)}`,
    );
    const fetcher = vi.fn(
      async () => new Response(new Blob(["pixels"], { type: "image/png" })),
    );
    vi.stubGlobal("fetch", fetcher);
    const images = await load();
    const result = await images.uploadImage("https://cdn.example/original.png");
    expect(fetcher).toHaveBeenCalledWith(
      "/proxy?url=https%3A%2F%2Fcdn.example%2Foriginal.png",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result).toMatchObject({
      width: 1280,
      height: 720,
      bytes: 6,
      mimeType: "image/png",
    });
    expect(await (await images.getImageBlob(result.storageKey!))!.text()).toBe(
      "pixels",
    );
  });

  it("keeps a displayable HTTP source only for a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("CORS blocked")),
    );
    const images = await load();
    expect(await images.uploadImage("https://cdn.example/remote.png")).toEqual({
      url: "https://cdn.example/remote.png",
      width: 1280,
      height: 720,
      bytes: 0,
      mimeType: "",
    });
    expect(table("image_files").size).toBe(0);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("denied", { status: 403 })),
    );
    await expect(
      images.uploadImage("https://cdn.example/denied.png"),
    ).rejects.toMatchObject({ name: "ImageResponseError" });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("propagates the download deadline and clears its timer without a remote fallback", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      (_source: string, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const images = await load();
    const timedOut = images.uploadImage("https://cdn.example/slow.png", {
      timeoutMs: 25,
    });
    const assertion = expect(timedOut).rejects.toMatchObject({
      name: "ImageTimeoutError",
    });
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("cleans up temporary URLs and decode timers when canceled or decoding times out", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "Image",
      class {
        onload = null;
        onerror = null;
        set src(_source: string) {}
      },
    );
    const images = await load();
    const controller = new AbortController();
    const canceled = images.uploadImage(new Blob(["canceled"]), {
      signal: controller.signal,
    });
    const canceledAssertion = expect(canceled).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await canceledAssertion;
    expect(vi.getTimerCount()).toBe(0);
    const stalled = images.uploadImage(new Blob(["stalled"]));
    const timeoutAssertion = expect(stalled).rejects.toThrow(
      "common.imageReadFailed",
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await timeoutAssertion;
    expect(vi.getTimerCount()).toBe(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(table("image_files").size).toBe(0);
  });

  it("converts downloaded image bytes and passes existing data URLs through unchanged", async () => {
    const bytes = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(new Blob(["pixels"], { type: "image/png" })),
      ),
    );
    vi.stubGlobal(
      "FileReader",
      class {
        result = "";
        onload: (() => void) | null = null;
        onerror = null;
        onabort = null;
        readAsDataURL(blob: Blob) {
          bytes(blob);
          this.result = "data:image/png;base64,cGl4ZWxz";
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    const images = await load();
    expect(
      await images.imageToDataUrl({ url: "https://cdn.example/image.png" }),
    ).toBe("data:image/png;base64,cGl4ZWxz");
    expect(await (bytes.mock.calls[0][0] as Blob).text()).toBe("pixels");
    expect(
      await images.imageToDataUrl({ dataUrl: "data:image/png;base64,known" }),
    ).toBe("data:image/png;base64,known");
    expect(fetch).toHaveBeenCalledOnce();
    const controller = new AbortController();
    controller.abort();
    await expect(
      images.imageToDataUrl(
        { dataUrl: "data:image/png;base64,known" },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("aborts an active FileReader without retaining its cancellation handler", async () => {
    const started = deferred();
    const abort = vi.fn();
    let reader!: { onload: unknown; onerror: unknown; onabort: unknown };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(new Blob(["pixels"], { type: "image/png" })),
      ),
    );
    vi.stubGlobal(
      "FileReader",
      class {
        onload = null;
        onerror = null;
        onabort = null;
        abort = abort;
        constructor() {
          reader = this;
        }
        readAsDataURL() {
          started.resolve();
        }
      },
    );
    const images = await load();
    const controller = new AbortController();
    const converting = images.imageToDataUrl(
      { url: "https://cdn.example/image.png" },
      { signal: controller.signal },
    );
    const assertion = expect(converting).rejects.toMatchObject({
      name: "AbortError",
    });
    await started.promise;
    controller.abort();
    await assertion;
    expect(abort).toHaveBeenCalledOnce();
    expect(reader.onload).toBeNull();
    expect(reader.onerror).toBeNull();
    expect(reader.onabort).toBeNull();
  });
});
