import { describe, expect, it, vi } from "vitest";

import { createRetryableLoader } from "@/lib/canvas/retryable-loader";
import {
  addPluginCacheBuster,
  normalizePluginHttpUrl,
} from "@/lib/canvas/plugin-url";

describe("plugin loader support", () => {
  it("accepts only HTTP(S) plugin sources and resolves relative paths", () => {
    expect(
      normalizePluginHttpUrl("/plugins/example.js", "https://studio.test"),
    ).toBeInstanceOf(URL);
    expect(
      normalizePluginHttpUrl("javascript:alert(1)", "https://studio.test"),
    ).toBeNull();
    expect(
      normalizePluginHttpUrl("data:text/javascript,1", "https://studio.test"),
    ).toBeNull();
  });

  it("updates only the cache-busting query and keeps the fragment", () => {
    const result = addPluginCacheBuster(
      "/plugins/example.js?theme=dark#entry",
      "https://studio.test",
      42,
    );
    const url = new URL(result);
    expect(url.origin).toBe("https://studio.test");
    expect(url.pathname).toBe("/plugins/example.js");
    expect(url.searchParams.get("theme")).toBe("dark");
    expect(url.searchParams.get("_plugin_refresh")).toBe("42");
    expect(url.hash).toBe("#entry");
  });

  it("coalesces startup work and retries after an incomplete pass", async () => {
    const load = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const ensureLoaded = createRetryableLoader(load);

    await Promise.all([ensureLoaded(), ensureLoaded()]);
    expect(load).toHaveBeenCalledOnce();
    await Promise.all([ensureLoaded(), ensureLoaded()]);
    expect(load).toHaveBeenCalledTimes(2);
    await ensureLoaded();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
