import { saveAs } from "file-saver";

import i18n from "@/i18n";
import { createZip } from "@/lib/zip";
import { getMediaBlob } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";
import type { CanvasExportAsset, CanvasExportFile } from "@/types/canvas-export";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

type ArchiveEntry = { name: string; data: BlobPart };

const MIME_EXTENSIONS: ReadonlyArray<readonly [string, string]> = [
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/avif", "avif"],
  ["video/mp4", "mp4"],
  ["video/webm", "webm"],
  ["video/quicktime", "mov"],
  ["audio/mpeg", "mp3"],
  ["audio/mp4", "m4a"],
  ["audio/wav", "wav"],
  ["audio/ogg", "ogg"],
  ["audio/opus", "opus"],
  ["audio/aac", "aac"],
  ["audio/flac", "flac"],
];

function readStoredAsset(storageKey: string) {
  return storageKey.startsWith("image:")
    ? getImageBlob(storageKey)
    : getMediaBlob(storageKey);
}

function createNameAllocator() {
  const reserved = new Set<string>();
  return (label: string, extension: string) => {
    const base = cleanFileName(label) || i18n.t("canvas.export.item");
    let suffix = 0;
    let candidate = `${base}.${extension}`;
    while (reserved.has(candidate.toLocaleLowerCase())) {
      suffix += 1;
      candidate = `${base}-${suffix}.${extension}`;
    }
    reserved.add(candidate.toLocaleLowerCase());
    return candidate;
  };
}

async function collectProjectArchive(project: CanvasProject) {
  const keys = collectAssetKeys(project);
  const resolved = await Promise.all(keys.map(async (storageKey) => {
    const blob = await readStoredAsset(storageKey);
    if (!blob) return null;
    const path = [
      "projects",
      encodeArchiveSegment(project.id),
      "files",
      `${encodeArchiveSegment(storageKey)}.${extensionFor(blob.type, storageKey)}`,
    ].join("/");
    const asset: CanvasExportAsset = {
      storageKey,
      path,
      mimeType: blob.type || "application/octet-stream",
      bytes: blob.size,
    };
    return { storageKey, asset, entry: { name: path, data: blob } satisfies ArchiveEntry };
  }));

  const available = resolved
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) => left.storageKey.localeCompare(right.storageKey));
  return {
    project,
    assets: available.map(({ asset }) => asset),
    entries: available.map(({ entry }) => entry),
  };
}

export async function exportCanvasProjects(
  projects: CanvasProject[],
  fileName = i18n.t("canvas.export.defaultProjectName"),
) {
  const archives = await Promise.all(projects.map(collectProjectArchive));
  const manifest: CanvasExportFile = {
    app: "yingxu-atlas",
    version: 4,
    exportedAt: new Date().toISOString(),
    projects: archives.map(({ project, assets }) => ({ project, files: assets })),
  };
  const entries = archives.flatMap(({ entries }) => entries);
  const zip = await createZip([
    { name: "projects.json", data: JSON.stringify(manifest, null, 2) },
    ...entries,
  ]);
  saveAs(zip, `${cleanFileName(fileName) || "canvas-projects"}.zip`);
}

export async function exportCanvasNodes(
  nodes: CanvasNodeData[],
  fileName = i18n.t("canvas.export.defaultNodesName"),
) {
  const allocateName = createNameAllocator();
  const entries: ArchiveEntry[] = [];

  for (const node of nodes) {
    const title = node.title || node.type;
    const key = node.metadata?.storageKey || "";
    if (key) {
      const blob = await readStoredAsset(key);
      if (blob) {
        entries.push({ name: allocateName(title, extensionFor(blob.type, key)), data: blob });
        continue;
      }
    }

    if (node.type === CanvasNodeType.Text) {
      entries.push({
        name: allocateName(title, "txt"),
        data: node.metadata?.content || node.metadata?.prompt || "",
      });
      continue;
    }

    const content = node.metadata?.content;
    if (content?.startsWith("data:")) {
      const blob = await (await fetch(content)).blob();
      entries.push({ name: allocateName(title, extensionFor(blob.type, key)), data: blob });
      continue;
    }

    entries.push({
      name: allocateName(title, "json"),
      data: JSON.stringify(node, null, 2),
    });
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));
  const archive = await createZip(entries);
  saveAs(archive, `${cleanFileName(fileName) || "canvas-assets"}.zip`);
}

function collectAssetKeys(value: unknown, found = new Set<string>()): string[] {
  if (value === null || typeof value !== "object") return [...found];
  if (Array.isArray(value)) {
    for (const child of value) collectAssetKeys(child, found);
    return [...found];
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "storageKey" && typeof child === "string" && child.includes(":")) {
      found.add(child);
    } else {
      collectAssetKeys(child, found);
    }
  }
  return [...found];
}

function cleanFileName(value: string) {
  return value
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/^\.+$/, "_")
    .trim();
}

function encodeArchiveSegment(value: string) {
  return encodeURIComponent(value).replace(/\./g, "%2E");
}

function extensionFor(mimeType: string, storageKey: string) {
  const mime = mimeType.split(";", 1)[0].trim().toLowerCase();
  const match = MIME_EXTENSIONS.find(([type]) => type === mime);
  if (match) return match[1];

  const storedExtension = storageKey.match(/\.([a-z0-9]{1,8})$/i)?.[1];
  if (storedExtension) return storedExtension.toLowerCase();
  return storageKey.startsWith("image:") ? "png" : "bin";
}
