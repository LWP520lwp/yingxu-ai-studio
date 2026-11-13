import type { PlatformAsset } from "@/platform/rpc";
import type { Asset } from "@/types/asset";
import type { CanvasNodeData } from "@/types/canvas";
import type { InsertAssetPayload } from "@/atlas-engine/ui/asset-picker";

export type LibrarySource = "local" | "project" | "canvas" | "account";
export type LibraryKind = "text" | "image" | "video" | "audio";
export type LibraryItem = {
  id: string;
  source: LibrarySource;
  kind: LibraryKind;
  title: string;
  preview?: string;
  excerpt?: string;
  tags: readonly string[];
  bytes?: number;
  payload?: InsertAssetPayload;
  textUrl?: string;
};

/** Source records are projected into display entries; no repository is mutated. */
export function localLibraryItems(assets: readonly Asset[]): LibraryItem[] {
  return assets.map((asset) => {
    const base = {
      id: `local:${asset.id}`,
      source: "local" as const,
      title: asset.title,
      kind: asset.kind,
      tags: asset.tags || [],
    };
    if (asset.kind === "text")
      return {
        ...base,
        excerpt: asset.data.content,
        payload: {
          kind: "text",
          title: asset.title,
          content: asset.data.content,
        },
      };
    if (asset.kind === "image")
      return {
        ...base,
        preview: asset.coverUrl || asset.data.dataUrl,
        bytes: asset.data.bytes,
        payload: {
          kind: "image",
          title: asset.title,
          dataUrl: asset.data.dataUrl,
          storageKey: asset.data.storageKey,
        },
      };
    return {
      ...base,
      preview: asset.coverUrl || undefined,
      bytes: asset.data.bytes,
      payload: {
        kind: "video",
        title: asset.title,
        url: asset.data.url,
        storageKey: asset.data.storageKey,
        width: asset.data.width,
        height: asset.data.height,
        mimeType: asset.data.mimeType,
      },
    };
  });
}

export function projectLibraryItems(
  assets: readonly PlatformAsset[],
  source: "project" | "account" = "project",
): LibraryItem[] {
  const seen = new Set<string>();
  return assets.flatMap((asset): LibraryItem[] => {
    if (
      !asset ||
      typeof asset.id !== "string" ||
      seen.has(asset.id) ||
      typeof asset.url !== "string" ||
      !asset.url.trim()
    )
      return [];
    const mime =
      typeof asset.mimeType === "string"
        ? asset.mimeType.toLowerCase().split(";")[0].trim()
        : "";
    const kind: LibraryKind | null = mime.startsWith("image/")
      ? "image"
      : mime.startsWith("video/")
        ? "video"
        : mime.startsWith("audio/")
          ? "audio"
          : mime.startsWith("text/") || mime === "application/json"
            ? "text"
            : null;
    if (!kind) return [];
    seen.add(asset.id);
    const title = asset.name || asset.id;
    const entry = {
      id: `${source}:${asset.id}`,
      source,
      kind,
      title,
      tags: [],
      bytes: asset.size,
    };
    if (kind === "text") return [{ ...entry, textUrl: asset.url }];
    if (kind === "image")
      return [
        {
          ...entry,
          preview: asset.url,
          payload: { kind, title, dataUrl: asset.url },
        },
      ];
    return [
      { ...entry, payload: { kind, title, url: asset.url, mimeType: mime } },
    ];
  });
}

export function canvasLibraryItems(
  nodes: readonly CanvasNodeData[],
): LibraryItem[] {
  const entries: LibraryItem[] = [];
  for (const node of nodes) {
    const meta = node.metadata;
    if (!meta) continue;
    const base = { source: "canvas" as const, title: node.title, tags: [] };
    if (node.type === "image") {
      const versions =
        meta.images?.filter(
          (image) => image.content && image.status === "success",
        ) || [];
      const images = versions.length
        ? versions
        : meta.content
          ? [
              {
                id: "main",
                content: meta.content,
                storageKey: meta.storageKey,
                bytes: meta.bytes,
              },
            ]
          : [];
      images.forEach((image, index) => {
        const title =
          images.length > 1 ? `${node.title} · ${index + 1}` : node.title;
        entries.push({
          ...base,
          id: `canvas:${node.id}:${image.id}`,
          title,
          kind: "image",
          preview: image.content,
          bytes: image.bytes,
          payload: {
            kind: "image",
            title,
            dataUrl: image.content,
            storageKey: image.storageKey,
          },
        });
      });
    } else if (node.type === "text") {
      const versions =
        meta.texts?.filter(
          (text) => text.content && text.status === "success",
        ) || [];
      const texts = versions.length
        ? versions
        : meta.content?.trim()
          ? [{ id: "main", content: meta.content }]
          : [];
      texts.forEach((text, index) => {
        const title =
          texts.length > 1 ? `${node.title} · ${index + 1}` : node.title;
        entries.push({
          ...base,
          id: `canvas:${node.id}:${text.id}`,
          title,
          kind: "text",
          excerpt: text.content,
          payload: { kind: "text", title, content: text.content },
        });
      });
    } else if (
      (node.type === "video" || node.type === "audio") &&
      meta.content
    ) {
      const kind = node.type === "audio" ? "audio" : "video";
      const common = {
        title: node.title,
        url: meta.content,
        storageKey: meta.storageKey,
        mimeType: meta.mimeType,
      };
      entries.push({
        ...base,
        id: `canvas:${node.id}`,
        kind,
        bytes: meta.bytes,
        payload:
          kind === "audio"
            ? { kind, ...common }
            : {
                kind,
                ...common,
                width: meta.naturalWidth,
                height: meta.naturalHeight,
              },
      });
    }
  }
  return entries;
}

export function filterLibraryItems(
  items: readonly LibraryItem[],
  kind: LibraryKind | "all",
  query: string,
): LibraryItem[] {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return items.filter(
    (item) =>
      (kind === "all" || item.kind === kind) &&
      terms.every((term) =>
        [item.title, item.excerpt || "", ...item.tags]
          .join(" ")
          .toLocaleLowerCase()
          .includes(term),
      ),
  );
}

/** Only stored same-origin text is fetched with the signed-in browser session. */
export function libraryTextAddress(
  value: string,
  origin: string,
): string | null {
  try {
    const url = new URL(value, origin);
    return url.origin === origin &&
      !url.username &&
      !url.password &&
      /^\/api\/assets\/[^/]+\/content$/.test(url.pathname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
