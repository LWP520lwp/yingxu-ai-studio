import { describe, expect, it } from "vitest";

import {
  initialPluginCatalogSession,
  reducePluginCatalogSession,
} from "@/atlas-engine/plugins/catalog-session";

describe("plugin catalog session", () => {
  it("accepts only the newest refresh result", () => {
    const loading = reducePluginCatalogSession(initialPluginCatalogSession, {
      type: "refresh",
      revision: 1,
    });
    const newer = reducePluginCatalogSession(loading, {
      type: "refresh",
      revision: 2,
    });
    const late = reducePluginCatalogSession(newer, {
      type: "loaded",
      revision: 1,
      entries: [],
    });
    expect(late).toBe(newer);
    expect(
      reducePluginCatalogSession(newer, {
        type: "loaded",
        revision: 2,
        entries: [],
      }).phase,
    ).toBe("ready");
  });

  it("keeps cached entries visible after a failed refresh and invalidates close", () => {
    const loading = reducePluginCatalogSession(initialPluginCatalogSession, {
      type: "refresh",
      revision: 1,
    });
    const ready = reducePluginCatalogSession(loading, {
      type: "loaded",
      revision: 1,
      entries: [
        {
          id: "demo",
          name: "Demo",
          version: "1.0.0",
          url: "https://example.com/demo.js",
          description: "",
        },
      ],
    });
    const refreshing = reducePluginCatalogSession(ready, {
      type: "refresh",
      revision: 2,
    });
    const failed = reducePluginCatalogSession(refreshing, {
      type: "failed",
      revision: refreshing.revision,
      error: "offline",
    });
    expect(failed.entries).toHaveLength(1);
    expect(failed.phase).toBe("failed");
    const closed = reducePluginCatalogSession(failed, { type: "closed" });
    expect(closed.revision).toBe(failed.revision + 1);
    expect(closed.error).toBeNull();
  });
});
