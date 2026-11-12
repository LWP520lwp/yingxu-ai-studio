import { describe, expect, it } from "vitest";

import { readCanvasArchive } from "@/lib/canvas/canvas-archive";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { CanvasExportAsset } from "@/types/canvas-export";

const project = (id = "project-one"): CanvasProject => ({
    id, title: "项目", createdAt: "2026-11-11", updatedAt: "2026-11-11",
    nodes: [{ id: "text", type: "text", title: "文本", position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { content: "保留数据" } }],
    connections: [], chatSessions: [], activeChatId: null, backgroundMode: "lines", showImageInfo: false, viewport: { x: 0, y: 0, k: 1 },
});

const asset: CanvasExportAsset = { storageKey: "image:asset-one", path: "projects/project-one/files/image_asset-one.png", mimeType: "image/png", bytes: 4 };
const makeZip = (manifest: unknown, files: Record<string, Blob> = {}) => new Map<string, Blob>([["projects.json", new Blob([JSON.stringify(manifest)], { type: "application/json" })], ...Object.entries(files)]);

describe("canvas project archive reader", () => {
    it("reads the owned archive format and restores typed media blobs", async () => {
        const image = new Blob([new Uint8Array([1, 2, 3, 4])]);
        const result = await readCanvasArchive(makeZip({
            app: "yingxu-atlas", version: 4, exportedAt: "2026-11-11",
            projects: [{ project: project(), files: [asset] }],
        }, { [asset.path]: image }));
        expect(result).toHaveLength(1);
        expect(result[0].project.nodes[0].metadata?.content).toBe("保留数据");
        expect(result[0].files[0].blob.type).toBe("image/png");
        expect(result[0].files[0].blob.size).toBe(4);
    });

    it("continues to import existing v3 backups", async () => {
        const [restored] = await readCanvasArchive(makeZip({ app: "infinite-canvas", version: 3, projects: [{ project: project(), files: [] }] }));
        expect(restored.project.id).toBe("project-one");
    });

    it.each([
        ["unknown format", { app: "other", version: 3, projects: [{ project: project(), files: [] }] }, "不支持此画布备份格式"],
        ["duplicate node IDs", { app: "yingxu-atlas", version: 4, projects: [{ project: { ...project(), nodes: [project().nodes[0], project().nodes[0]] }, files: [] }] }, "节点标识重复"],
        ["unsafe asset paths", { app: "yingxu-atlas", version: 4, projects: [{ project: project(), files: [{ ...asset, path: "../outside.png" }] }] }, "素材索引不正确"],
    ])("rejects %s before writing restored data", async (_case, manifest, error) => {
        await expect(readCanvasArchive(makeZip(manifest))).rejects.toThrow(error as string);
    });

    it("rejects missing or size-mismatched archive media without a partial restore result", async () => {
        const manifest = { app: "yingxu-atlas", version: 4, projects: [{ project: project(), files: [asset] }] };
        await expect(readCanvasArchive(makeZip(manifest))).rejects.toThrow("素材“projects/project-one/files/image_asset-one.png”缺失");
        await expect(readCanvasArchive(makeZip(manifest, { [asset.path]: new Blob(["short"]) }))).rejects.toThrow("大小与清单不一致");
    });
});
