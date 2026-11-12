import { saveAs } from "file-saver";

import i18n from "@/i18n";
import { createZip } from "@/lib/zip";
import { getMediaBlob } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";
import type { CanvasExportAsset, CanvasExportFile } from "@/types/canvas-export";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

type ZipEntry = { name: string; data: BlobPart };

function storageBlob(storageKey: string) {
    return storageKey.startsWith("image:") ? getImageBlob(storageKey) : getMediaBlob(storageKey);
}

function uniqueNameFactory() {
    const used = new Set<string>();
    return (label: string, extension: string) => {
        const base = safeFileName(label) || i18n.t("canvas.export.item");
        let candidate = `${base}.${extension}`;
        let suffix = 1;
        while (used.has(candidate)) candidate = `${base}-${suffix++}.${extension}`;
        used.add(candidate);
        return candidate;
    };
}

async function projectArchive(project: CanvasProject) {
    const entries = await Promise.all(collectStorageKeys(project).map(async (storageKey) => {
        const blob = await storageBlob(storageKey);
        if (!blob) return null;
        const path = `projects/${archiveSegment(project.id)}/files/${archiveSegment(storageKey)}.${fileExtension(blob.type, storageKey)}`;
        return { storageKey, asset: { storageKey, path, mimeType: blob.type || "application/octet-stream", bytes: blob.size }, entry: { name: path, data: blob } satisfies ZipEntry };
    }));
    const available = entries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)).sort((left, right) => left.storageKey.localeCompare(right.storageKey));
    return { project, files: available.map(({ asset }) => asset), entries: available.map(({ entry }) => entry) };
}

export async function exportCanvasProjects(projects: CanvasProject[], fileName = i18n.t("canvas.export.defaultProjectName")) {
    const archives = await Promise.all(projects.map(projectArchive));
    const exportedProjects = archives.map(({ project, files }) => ({ project, files }));
    const data: CanvasExportFile = { app: "yingxu-atlas", version: 4, exportedAt: new Date().toISOString(), projects: exportedProjects };
    const entries = archives.flatMap(({ entries }) => entries);
    const zip = await createZip([{ name: "projects.json", data: JSON.stringify(data, null, 2) }, ...entries]);
    saveAs(zip, `${safeFileName(fileName)}.zip`);
}

export async function exportCanvasNodes(nodes: CanvasNodeData[], fileName = i18n.t("canvas.export.defaultNodesName")) {
    const nameFor = uniqueNameFactory();
    const entries: ZipEntry[] = [];
    for (const node of nodes) {
        const title = node.title || node.type;
        const storageKey = node.metadata?.storageKey || "";
        if (storageKey) {
            const blob = await storageBlob(storageKey);
            if (blob) {
                entries.push({ name: nameFor(title, fileExtension(blob.type, storageKey)), data: blob });
                continue;
            }
        }
        if (node.type === CanvasNodeType.Text) {
            entries.push({ name: nameFor(title, "txt"), data: node.metadata?.content || node.metadata?.prompt || "" });
            continue;
        }
        const content = node.metadata?.content;
        if (content?.startsWith("data:")) {
            const blob = await (await fetch(content)).blob();
            entries.push({ name: nameFor(title, fileExtension(blob.type, storageKey)), data: blob });
            continue;
        }
        entries.push({ name: nameFor(title, "json"), data: JSON.stringify(node, null, 2) });
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    const zip = await createZip(entries);
    saveAs(zip, `${safeFileName(fileName)}.zip`);
}

function collectStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return [...keys];
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.includes(":")) keys.add(value.storageKey);
    for (const item of Object.values(value)) {
        if (Array.isArray(item)) for (const child of item) collectStorageKeys(child, keys);
        else collectStorageKeys(item, keys);
    }
    return [...keys];
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^\.+$/, "_").trim();
}

function archiveSegment(value: string) {
    return encodeURIComponent(value).replace(/\./g, "%2E");
}

function fileExtension(mimeType: string, storageKey: string) {
    const mime = mimeType.toLowerCase();
    const extensions: Array<[string, string]> = [["png", "png"], ["jpeg", "jpg"], ["webp", "webp"], ["gif", "gif"], ["mp4", "mp4"], ["webm", "webm"], ["quicktime", "mov"], ["mpeg", "mp3"], ["mp3", "mp3"], ["wav", "wav"], ["ogg", "ogg"], ["opus", "opus"], ["aac", "aac"], ["flac", "flac"], ["mp4a", "m4a"]];
    const byMime = extensions.find(([fragment]) => mime.includes(fragment))?.[1];
    const byKey = storageKey.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase();
    return byMime || byKey || (storageKey.startsWith("image:") ? "png" : "bin");
}
