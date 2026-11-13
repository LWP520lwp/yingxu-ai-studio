import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchOfficialPluginCatalog, hasPluginUpgrade } from "@/atlas-engine/plugins/official-registry";

vi.mock("@/constant/env", () => ({
  PLUGIN_REGISTRY_URL: "https://plugins.example/registry.json",
}));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));

afterEach(() => vi.unstubAllGlobals());

describe("official plugin registry", () => {
  it("resolves relative entries and ignores malformed and duplicate entries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              plugins: [
                { id: " demo ", entry: "./dist/demo.js", name: " Demo " },
                { id: "demo", url: "https://other.example/replacement.js" },
                { id: "bad-scheme", url: "javascript:alert(1)" },
                { id: "missing-url" },
                null,
              ],
            }),
            { status: 200 },
          ),
      ),
    );

    await expect(fetchOfficialPluginCatalog()).resolves.toEqual([
      {
        id: "demo",
        name: "Demo",
        version: "0.0.0",
        description: undefined,
        icon: undefined,
        url: "https://plugins.example/dist/demo.js",
      },
    ]);
  });

  it("rejects a malformed registry URL and invalid JSON", async () => {
    await expect(fetchOfficialPluginCatalog("javascript:alert(1)")).rejects.toThrow();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not-json", { status: 200 })),
    );
    await expect(fetchOfficialPluginCatalog()).rejects.toThrow(
      "canvas.pluginErrors.registryFailed",
    );
  });

  it("passes cancellation through both the request and JSON decoding", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = fetchOfficialPluginCatalog(undefined, controller.signal);
    controller.abort(new DOMException("Closed", "AbortError"));

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://plugins.example/registry.json",
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("keeps the existing numeric three-part upgrade comparison", () => {
    expect(hasPluginUpgrade("1.2.3", "1.2.4")).toBe(true);
    expect(hasPluginUpgrade("1.2.3", "1.2.3-beta.1")).toBe(false);
    expect(hasPluginUpgrade("2.0.0", "1.99.99")).toBe(false);
  });
});
