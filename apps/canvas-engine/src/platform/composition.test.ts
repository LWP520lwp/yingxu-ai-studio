import { afterEach, describe, expect, it, vi } from "vitest";
import { readZip } from "@/lib/zip";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { atlasClipDurationMs, atlasCompositionVideos, createAtlasComposition, exportAtlasCompositionPackage, formatAtlasCompositionTime, moveAtlasCompositionClip, normalizeAtlasClip, type AtlasCompositionClip } from "@/atlas-engine/workflows/video-composition";

vi.mock("@/services/file-storage", () => ({ resolveMediaUrl: async (_key: string | undefined, fallback: string) => fallback }));
const video = (id: string, content = `/api/assets/${id}/content`): CanvasNodeData => ({ id, type: CanvasNodeType.Video, title: id, width: 400, height: 225, position: { x: 0, y: 0 }, metadata: { content, durationMs: 2000, storageKey: `video:${id}`, mimeType: "video/mp4" } });
const clip = (patch: Partial<AtlasCompositionClip> = {}): AtlasCompositionClip => ({ id: "one", sourceNodeId: "node-one", title: "视频一", url: "/one.mp4", startMs: 0, endMs: null, volume: 1, durationMs: 2000, ...patch });
afterEach(() => vi.unstubAllGlobals());

describe("native video composition", () => {
    it("only consumes actual completed video resources and copies source media references", () => {
        const nodes = [video("one"), video("empty", ""), { ...video("text"), type: CanvasNodeType.Text }, video("two")];
        expect(atlasCompositionVideos(nodes).map((node) => node.id)).toEqual(["one", "two"]);
        const result = createAtlasComposition(nodes);
        expect(result.clips.map((item) => [item.sourceNodeId, item.url, item.storageKey])).toEqual([["one", "/api/assets/one/content", "video:one"], ["two", "/api/assets/two/content", "video:two"]]);
        nodes[0].metadata!.content = "changed";
        expect(result.clips[0].url).toBe("/api/assets/one/content");
    });
    it("bounds invalid trim values and volume and calculates only the selected interval", () => {
        expect(normalizeAtlasClip(clip({ startMs: -30, endMs: 5000, volume: 3 }))).toMatchObject({ startMs: 0, endMs: 2000, volume: 1 });
        expect(normalizeAtlasClip(clip({ startMs: 5000, endMs: 1500, volume: -1 }))).toMatchObject({ startMs: 1900, endMs: 2000, volume: 0 });
        expect(atlasClipDurationMs(clip({ startMs: 500, endMs: 1750 }))).toBe(1250);
        expect(atlasClipDurationMs(clip({ startMs: 500, endMs: null }))).toBe(1500);
        expect(atlasClipDurationMs(clip({ durationMs: undefined }))).toBe(0);
    });
    it("keeps short clips valid and formats non-finite timestamps predictably", () => {
        expect(normalizeAtlasClip(clip({ durationMs: 50, startMs: 20, endMs: 30, volume: Number.NaN }))).toMatchObject({ startMs: 0, endMs: 50, volume: 1 });
        expect(normalizeAtlasClip(clip({ startMs: Number.NaN, endMs: Number.POSITIVE_INFINITY, volume: Number.NEGATIVE_INFINITY }))).toMatchObject({ startMs: 0, endMs: null, volume: 1 });
        expect(formatAtlasCompositionTime(59_950)).toBe("1:00.0");
        expect(formatAtlasCompositionTime(Number.NaN)).toBe("0:00.0");
        expect(formatAtlasCompositionTime(-100)).toBe("0:00.0");
    });
    it("changes order without changing originals or trimming and rejects out-of-range moves", () => {
        const first = clip({ startMs: 250, endMs: 1700, volume: .4 });
        const data = { version: 1 as const, clips: [first, clip({ id: "two" })] };
        const moved = moveAtlasCompositionClip(data, 0, 1);
        expect(moved.clips.map((item) => item.id)).toEqual(["two", "one"]);
        expect(moved.clips[1]).toEqual(first);
        expect(data.clips[0].id).toBe("one");
        expect(moveAtlasCompositionClip(data, 0, -1)).toBe(data);
        expect(moveAtlasCompositionClip(data, 0, 0.5)).toBe(data);
    });
    it("exports real media bytes, portable relative paths, trims and an offline sequential player", async () => {
        const fetcher = vi.fn(async () => new Response(new Blob([new Uint8Array([1, 9, 4, 2])], { type: "video/mp4" })));
        vi.stubGlobal("fetch", fetcher);
        const first = clip({ title: "</script><img src=x onerror=alert(1)>", startMs: 250, endMs: 1700, volume: .4, storageKey: "private-key" });
        const archive = await exportAtlasCompositionPackage({ version: 1, clips: [first, clip({ id: "two", url: "/two.webm" })] });
        const files = await readZip(archive);
        expect(new Uint8Array(await files.get("media/clip-01.mp4")!.arrayBuffer())).toEqual(new Uint8Array([1, 9, 4, 2]));
        const manifest = JSON.parse(await files.get("composition.json")!.text());
        expect(manifest.clips[0]).toMatchObject({ url: "media/clip-01.mp4", startMs: 250, endMs: 1700, volume: .4 });
        expect(manifest.clips[0]).not.toHaveProperty("storageKey");
        const html = await files.get("预览.html")!.text();
        expect(html).toContain("video.addEventListener('ended',next)");
        expect(html).not.toContain("</script><img");
        expect(html).toContain("\\u003c/script>");
        expect(fetcher).toHaveBeenCalledTimes(2);
    });
    it("deduplicates shared source bytes and fails instead of exporting unreadable or fake media", async () => {
        const fetcher = vi.fn(async () => new Response(new Blob(["video-bytes"], { type: "video/mp4" })));
        vi.stubGlobal("fetch", fetcher);
        const files = await readZip(await exportAtlasCompositionPackage({ version: 1, clips: [clip(), clip({ id: "second", startMs: 1000 })] }));
        expect([...files.keys()].filter((name) => name.startsWith("media/"))).toHaveLength(1);
        expect(fetcher).toHaveBeenCalledTimes(1);
        vi.stubGlobal("fetch", async () => new Response("missing", { status: 404 }));
        await expect(exportAtlasCompositionPackage({ version: 1, clips: [clip()] })).rejects.toThrow("无法读取");
        vi.stubGlobal("fetch", async () => new Response(new Blob(["not video"], { type: "text/html" })));
        await expect(exportAtlasCompositionPackage({ version: 1, clips: [clip()] })).rejects.toThrow("不是可导出的视频素材");
    });
});
