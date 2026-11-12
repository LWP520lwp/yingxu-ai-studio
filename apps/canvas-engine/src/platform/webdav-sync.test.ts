import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/stores/use-config-store", () => ({
  withLocalProxy: (url: string) => url,
}));

vi.mock("@/i18n", () => ({
  default: {
    t: (key: string, options?: unknown) =>
      `${key}:${JSON.stringify(options || {})}`,
  },
}));

import {
  downloadWebdavFile,
  uploadWebdavFile,
  WEBDAV_MANIFEST_FILE_NAME,
} from "@/services/webdav-sync";
import type { WebdavSyncConfig } from "@/stores/use-config-store";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function config(directory: string): WebdavSyncConfig {
  return {
    url: "https://dav.example/root",
    username: "用户",
    password: "密钥",
    directory,
    lastSyncedAt: "",
  };
}

describe("WebDAV transport", () => {
  it("encodes remote path segments and sends UTF-8 Basic Auth", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (init.method === "MKCOL" && url.endsWith("/assets")) {
        return new Response(null, { status: 201 });
      }
      if (init.method === "MKCOL" && url.endsWith("/assets%20pack")) {
        return new Response(null, { status: 201 });
      }
      return new Response(null, { status: 201 });
    });

    await uploadWebdavFile(
      config("canvas folder"),
      "assets pack/final #1.bin",
      new Blob(["file"]),
      "application/octet-stream",
    );

    const put = calls.find(({ init }) => init.method === "PUT");
    expect(put?.url).toBe(
      "https://dav.example/root/canvas%20folder/assets%20pack/final%20%231.bin",
    );
    expect(put?.init.headers).toBeInstanceOf(Headers);
    expect((put?.init.headers as Headers).get("Content-Type")).toBe(
      "application/octet-stream",
    );
    const encodedCredential = (put?.init.headers as Headers).get(
      "Authorization",
    );
    expect(encodedCredential).toBe(
      `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode("用户:密钥")))}`,
    );
  });

  it("deduplicates concurrent directory creation for the same scope", async () => {
    const methods: string[] = [];
    let finishCreate!: (response: Response) => void;
    const createResult = new Promise<Response>((resolve) => {
      finishCreate = resolve;
    });
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      methods.push(String(init.method));
      if (init.method === "MKCOL") return createResult;
      return new Response(null, { status: 207 });
    });

    const selectedConfig = config("parallel-create");
    const first = downloadWebdavFile(selectedConfig, "one.json");
    const second = downloadWebdavFile(selectedConfig, "two.json");
    await Promise.resolve();
    await Promise.resolve();
    expect(methods.filter((method) => method === "MKCOL")).toHaveLength(1);
    finishCreate(new Response(null, { status: 201 }));

    await expect(Promise.all([first, second])).resolves.toEqual([null, null]);
  });

  it("rejects traversal before sending a request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(
      downloadWebdavFile(config("safe"), "../outside.json"),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("aborts the active request and releases its timeout", async () => {
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
    const controller = new AbortController();
    const request = downloadWebdavFile(
      config("abort-case"),
      "manifest.json",
      controller.signal,
    );
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the exported manifest filename for existing sync callers", async () => {
    expect(WEBDAV_MANIFEST_FILE_NAME).toBe("manifest.json");
  });
});
