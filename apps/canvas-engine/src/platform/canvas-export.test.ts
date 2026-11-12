import { afterEach, describe, expect, it, vi } from "vitest";
import { readZip } from "@/lib/zip";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const downloads = vi.hoisted(() => ({ saveAs: vi.fn() }));
vi.mock("file-saver", () => ({ saveAs: downloads.saveAs }));
vi.mock("@/services/image-storage", () => ({ getImageBlob: async () => new Blob(["image"], { type: "image/avif" }) }));
vi.mock("@/services/file-storage", () => ({ getMediaBlob: async (key: string) => {
    await new Promise((resolve) => setTimeout(resolve, key.endsWith("second") ? 1 : 4));
    return new Blob([key], { type: "video/quicktime" });
} }));

import { exportCanvasNodes, exportCanvasProjects } from "@/lib/canvas/canvas-export";

const project: CanvasProject = {
    id: "../project:one", title: "备份", createdAt: "2026-11-11", updatedAt: "2026-11-11",
    nodes: [{ id: "video", type: CanvasNodeType.Video, title: "片段", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { content: "/video", storageKey: "video:first" } }],
    connections: [], chatSessions: [], activeChatId: null, backgroundMode: "lines", showImageInfo: false, viewport: { x: 0, y: 0, k: 1 },
};

const videoNode = (id: string, storageKey: string): CanvasNodeData => ({
    id, type: CanvasNodeType.Video, title: "同名片段", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { content: "/video", storageKey },
});

afterEach(() => { downloads.saveAs.mockReset(); vi.unstubAllGlobals(); });

describe("canvas archive exporter", () => {
    it("writes the owned versioned manifest and safe asset paths", async () => {
        await exportCanvasProjects([project], "备份");
        const [archive, fileName] = downloads.saveAs.mock.calls[0] as [Blob, string];
        const files = await readZip(archive);
        const manifest = JSON.parse(await files.get("projects.json")!.text());
        expect(fileName).toBe("备份.zip");
        expect(manifest).toMatchObject({ app: "yingxu-atlas", version: 4, projects: [{ project: { id: "../project:one" } }] });
        expect(manifest.projects[0].files[0].path).toBe("projects/%2E%2E%2Fproject%3Aone/files/video%3Afirst.mov");
        expect(await files.get(manifest.projects[0].files[0].path)!.text()).toBe("video:first");
    });

    it("assigns duplicate node filenames in source order despite storage timing", async () => {
        await exportCanvasNodes([videoNode("first", "video:first"), videoNode("second", "video:second")]);
        const [archive] = downloads.saveAs.mock.calls[0] as [Blob, string];
        const files = await readZip(archive);
        expect([...files.keys()].sort()).toEqual(["同名片段-1.mov", "同名片段.mov"]);
        expect(await files.get("同名片段.mov")!.text()).toBe("video:first");
        expect(await files.get("同名片段-1.mov")!.text()).toBe("video:second");
    });
});
