import { afterEach, describe, expect, it, vi } from "vitest";

import { testLocalProxy } from "@/services/api/local-proxy";

describe("local proxy reachability", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("normalizes the address and reports the proxy identity", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ proxy: " Muse Proxy ", version: "1.2.3" }),
          {
            status: 200,
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(testLocalProxy(" 127.0.0.1:23210/ ")).resolves.toBe(
      "Muse Proxy v1.2.3",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:23210/",
      expect.objectContaining({
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("rejects missing URLs, non-success responses and invalid identity payloads", async () => {
    await expect(testLocalProxy("  ")).rejects.toThrow();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 })),
    );
    await expect(testLocalProxy("http://127.0.0.1:23210")).rejects.toThrow();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    await expect(testLocalProxy("http://127.0.0.1:23210")).rejects.toThrow();
  });

  it("forwards caller cancellation and bounds a stalled request", async () => {
    const cancelled = new Error("cancelled by caller");
    const controller = new AbortController();
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const request = testLocalProxy("http://127.0.0.1:23210", {
      signal: controller.signal,
      timeoutMs: 100,
    });
    const cancelledRequest = expect(request).rejects.toBe(cancelled);
    controller.abort(cancelled);
    await cancelledRequest;

    vi.useFakeTimers();
    const stalledFetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        }),
    );
    vi.stubGlobal("fetch", stalledFetch);
    const timed = testLocalProxy("http://127.0.0.1:23210", { timeoutMs: 25 });
    const timedRequest = expect(timed).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(25);
    await timedRequest;
  });
});
