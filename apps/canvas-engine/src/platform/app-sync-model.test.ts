import { describe, expect, it } from "vitest";

import { decodeSyncManifest } from "@/lib/sync/manifest-codec";
import { mergeByTimestamp, mergeCanvasSyncData } from "@/lib/sync/merge-policy";
import {
  collectMediaStorageKeys,
  mediaNeedsUpload,
  planMediaDownloads,
} from "@/lib/sync/media-plan";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

const emptyCanvas = { projects: [], deleted: [] };
const fixedNow = "2026-11-11T00:00:00.000Z";
const project = (id: string, updatedAt: string): CanvasProject => ({
  id,
  title: id,
  createdAt: fixedNow,
  updatedAt,
  nodes: [],
  connections: [],
  chatSessions: [],
  activeChatId: null,
  backgroundMode: "lines",
  showImageInfo: false,
  viewport: { x: 0, y: 0, k: 1 },
});

function manifest(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    app: "infinite-canvas",
    version: 1,
    domain: "canvas",
    exportedAt: fixedNow,
    data: { projects: [], deleted: [] },
    files: [],
    ...overrides,
  });
}

describe("WebDAV manifest codec", () => {
  it("reads the supported legacy identity and normalizes the manifest envelope", () => {
    const decoded = decodeSyncManifest(
      manifest(),
      "canvas",
      emptyCanvas,
      fixedNow,
    );

    expect(decoded).toEqual({
      app: "yingxu-ai-studio",
      version: 1,
      domain: "canvas",
      exportedAt: fixedNow,
      data: { projects: [], deleted: [] },
      files: [],
    });
  });

  it.each([
    ["invalid JSON", "{"],
    ["mismatched domain", manifest({ domain: "assets" })],
    ["unknown version", manifest({ version: 9 })],
    ["non-object data", manifest({ data: [] })],
    [
      "invalid project records",
      manifest({ data: { projects: [null], deleted: [] } }),
    ],
    [
      "invalid tombstone timestamp",
      manifest({
        data: {
          projects: [],
          deleted: [{ id: "deleted", deletedAt: "yesterday" }],
        },
      }),
    ],
    [
      "unsafe media paths",
      manifest({
        files: [
          {
            storageKey: "image:one",
            path: "../outside",
            mimeType: "image/png",
            bytes: 1,
          },
        ],
      }),
    ],
    [
      "absolute media paths",
      manifest({
        files: [
          {
            storageKey: "image:one",
            path: "C:/outside",
            mimeType: "image/png",
            bytes: 1,
          },
        ],
      }),
    ],
  ])("rejects %s", (_label, serialized) => {
    expect(() =>
      decodeSyncManifest(serialized, "canvas", emptyCanvas, fixedNow),
    ).toThrow();
  });

  it("ignores a missing legacy canvas collection and omits duplicate media entries", () => {
    const decoded = decodeSyncManifest(
      manifest({
        data: {},
        files: [
          {
            storageKey: "image:one",
            path: "canvas/files/one.png",
            mimeType: "image/png",
            bytes: 1,
          },
          {
            storageKey: "image:one",
            path: "canvas/files/duplicate.png",
            mimeType: "image/png",
            bytes: 2,
          },
        ],
      }),
      "canvas",
      emptyCanvas,
      fixedNow,
    );

    expect(decoded.data).toEqual({ projects: [], deleted: [] });
    expect(decoded.files).toHaveLength(1);
    expect(decoded.files[0].path).toBe("canvas/files/one.png");
  });
});

describe("sync merge policy", () => {
  it("uses local records for equal timestamps and sorts ties by id", () => {
    const merged = mergeByTimestamp(
      [
        { id: "b", updatedAt: fixedNow, value: "local" },
        { id: "a", updatedAt: fixedNow },
      ],
      [{ id: "b", updatedAt: fixedNow, value: "remote" }],
      "updatedAt",
    );

    expect(merged.map((item) => item.id)).toEqual(["a", "b"]);
    expect(merged[1].value).toBe("local");
  });

  it("keeps deletion at an equal timestamp but restores later edits", () => {
    const result = mergeCanvasSyncData(
      {
        projects: [
          project("deleted", fixedNow),
          project("restored", "2026-11-12T00:00:00.000Z"),
        ],
        deleted: [],
      },
      {
        projects: [],
        deleted: [
          { id: "deleted", deletedAt: fixedNow },
          { id: "restored", deletedAt: fixedNow },
        ],
      },
    );

    expect(result.projects.map((project) => project.id)).toEqual(["restored"]);
    expect(result.deleted.map((item) => item.id)).toEqual(["deleted"]);
  });
});

describe("media transfer planning", () => {
  it("collects only well-formed storage keys once, including custom upload prefixes", () => {
    const document: Record<string, unknown> = {
      images: [{ storageKey: "image:one" }, { storageKey: "asset:two" }],
      metadata: { storageKey: "file:three" },
      text: "a URL https://example.test/image:ignored",
    };
    document.self = document;

    expect(collectMediaStorageKeys(document)).toEqual([
      "asset:two",
      "file:three",
      "image:one",
    ]);
  });

  it("downloads only referenced remote media that is absent locally", () => {
    const files = [
      {
        storageKey: "image:one",
        path: "canvas/one.png",
        mimeType: "image/png",
        bytes: 4,
      },
      {
        storageKey: "file:two",
        path: "canvas/two.mp4",
        mimeType: "video/mp4",
        bytes: 10,
      },
    ];

    expect(
      planMediaDownloads(
        ["image:one", "file:two", "missing:three"],
        new Set(["file:two"]),
        files,
      ),
    ).toEqual([files[0]]);
  });

  it("reuploads when the remote byte count or media type changed", () => {
    const remote = {
      storageKey: "image:one",
      path: "one.png",
      mimeType: "image/png",
      bytes: 4,
    };

    expect(
      mediaNeedsUpload(
        { storageKey: "image:one", bytes: 4, mimeType: "image/png" },
        remote,
      ),
    ).toBe(false);
    expect(
      mediaNeedsUpload(
        { storageKey: "image:one", bytes: 5, mimeType: "image/png" },
        remote,
      ),
    ).toBe(true);
    expect(
      mediaNeedsUpload(
        { storageKey: "image:one", bytes: 4, mimeType: "image/webp" },
        remote,
      ),
    ).toBe(true);
  });
});
