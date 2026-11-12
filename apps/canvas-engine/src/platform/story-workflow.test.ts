import { describe, expect, it, vi } from "vitest";
import { coreLabels, emptyStoryDocument, storyCanvasPayload, storyStyle, type StoryCharacter, type StorySegment, type StoryShot } from "../../../web/src/storyWorkflowModel";
import { createStoryWorkflowImport, readStoryWorkflowPayload, storyVideoModel } from "./story-workflow";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { PlatformModels } from "./rpc";

function payload() {
    const character: StoryCharacter = { id: "char_1", name: "陈青", aliases: ["小陈"], locked: true,
        core: Object.fromEntries(Object.keys(coreLabels).map((key) => [key, "固定外观"])) as StoryCharacter["core"],
        clothing: { upper: "灰色夹克", lower: "长裤", shoes: "白鞋", accessories: "手表" }, personality: "冷静", voice: "自然女声", assumptions: ["发型为拟定项"], imagePrompt: "真人写实，陈青全身白底照", threeViewPrompt: "同一人物正面侧面背面三视图" };
    const shots: StoryShot[] = Array.from({ length: 5 }, (_, index) => ({ start: index * 3, end: (index + 1) * 3, duration: 3, shotType: "中景", camera: "缓慢平移", visibleAction: "接过钥匙", sound: "钥匙碰撞声", narration: "无", sceneId: "scene_1", sceneDetail: "清晨仓库侧光",
        dialogue: index ? [] : [{ characterId: "char_1", text: "慢一点。" }], characters: [{ characterId: "char_1", position: "左侧", posture: "站立", action: "接过钥匙", wardrobe: "灰色夹克与长裤" }], propIds: ["prop_1"] }));
    const formattedPrompt = `${storyStyle}\n出镜角色汇总：陈青\n${shots.map((shot) => `${shot.start}s–${shot.end}s｜镜头类型：中景｜运镜方式：缓慢平移｜旁白：无`).join("\n")}`;
    const segment: StorySegment = { id: "segment_1", number: 1, script: "陈青接过钥匙，抬头看向门外。", createdAt: "2026-11-10T00:00:00Z", castIds: [character.id], shots, startState: null, style: storyStyle, formattedPrompt };
    return storyCanvasPayload({ ...emptyStoryDocument(), title: "院门", characters: [character],
        scenes: [{ id: "scene_1", name: "仓库", aliases: [], time: "清晨", weather: "晴", lighting: "侧光", space: "金属门旁通道", elements: "水泥地面", imagePrompt: "真人实景，清晨仓库，无人物" }],
        props: [{ id: "prop_1", name: "钥匙", material: "金属", size: "手掌大小", appearance: "银色", imagePrompt: "真人写实钥匙白底产品照" }] }, segment);
}
const models = (): PlatformModels => ({ image: [{ id: "image-one", available: true }], video: [{ id: "video-fifteen", available: true, caps: { durations: [5, 15], fixedWidth: 1280, fixedHeight: 720 } }] });
const build = (value = payload(), catalog = models(), existing: CanvasNodeData[] = []) => {
    let number = 0;
    return createStoryWorkflowImport(value, existing, catalog, { x: 0, y: 0 }, () => `id_${++number}`);
};

describe("reviewable continuous storyboard canvas import", () => {
    it("connects the original script, complete 15-second plan and only referenced profile image configurations", () => {
        const value = payload(); const before = JSON.stringify(value);
        const result = build(value);
        expect(result.duplicate).toBe(false); expect(result.nodes).toHaveLength(9); expect(result.connections).toHaveLength(8);
        expect(result.selectedIds).toEqual(result.nodes.map((node) => node.id)); expect(result.warnings).toEqual([]);
        const script = result.nodes.find((node) => node.metadata?.storyWorkflow?.role === "script")!;
        const storyboard = result.nodes.find((node) => node.metadata?.storyWorkflow?.role === "storyboard")!;
        const videos = result.nodes.filter((node) => node.metadata?.generationMode === "video");
        expect(script.metadata?.content).toBe(value.script); expect(storyboard.metadata?.content).toBe(value.formattedPrompt);
        expect(JSON.parse(storyboard.metadata!.storyWorkflow!.shotsJson!)).toEqual(value.shots);
        expect(videos).toHaveLength(1);
        expect(videos[0].metadata).toMatchObject({ seconds: "15", model: "platform::video-fifteen", videoMode: "auto", status: "idle", composerContent: `@[node:${storyboard.id}]` });
        expect(result.connections).toContainEqual(expect.objectContaining({ fromNodeId: storyboard.id, toNodeId: videos[0].id }));
        expect(result.nodes.filter((node) => node.metadata?.generationMode === "image")).toHaveLength(3);
        expect(result.nodes.every((node) => node.metadata?.status !== "loading" && !node.metadata?.videoTaskId)).toBe(true);
        expect(result.nodes.every((node) => node.metadata?.storyWorkflow?.segmentId === value.segmentId)).toBe(true);
        expect(JSON.stringify(value)).toBe(before);
    });

    it("retains complete text and unsubmitted image configurations when models are unavailable or cannot make 15 seconds", () => {
        const result = build(payload(), { image: [], video: [{ id: "doubao", available: true, caps: { fixedDuration: 10 } }, { id: "unknown", available: true, caps: { durations: [] } }] });
        expect(result.nodes.some((node) => node.metadata?.generationMode === "video")).toBe(false);
        expect(result.nodes.filter((node) => node.type === CanvasNodeType.Text)).toHaveLength(5);
        expect(result.nodes.filter((node) => node.metadata?.generationMode === "image").every((node) => node.metadata?.model === "" && node.metadata?.status === "idle")).toBe(true);
        expect(result.nodes.find((node) => node.metadata?.storyWorkflow?.role === "storyboard")?.metadata?.storyWorkflow?.pendingVideo).toBe(true);
        expect(result.warnings.join(" ")).toContain("未明确支持15秒"); expect(result.warnings.join(" ")).toContain("接入可用图像模型");
    });

    it("does not infer duration support from an empty capability list, backend bounds or conflicting fixed durations", () => {
        expect(storyVideoModel([{ id: "unknown", available: true }])).toBeUndefined();
        expect(storyVideoModel([{ id: "conflicting", available: true, caps: { fixedDuration: 10, durations: [15] } }])).toBeUndefined();
        expect(storyVideoModel([{ id: "disabled", available: false, caps: { fixedDuration: 15 } }])).toBeUndefined();
        expect(storyVideoModel([{ id: "fixed", available: true, caps: { fixedDuration: 15 } }])?.id).toBe("fixed");
    });

    it("deduplicates by persisted segment identity even after serialization and selects its existing nodes", () => {
        const first = build();
        const saved = JSON.parse(JSON.stringify(first.nodes)) as CanvasNodeData[];
        const allocate = vi.fn(() => "must_not_allocate");
        const repeated = createStoryWorkflowImport(payload(), saved, models(), { x: 100, y: 100 }, allocate);
        expect(repeated).toMatchObject({ duplicate: true, nodes: [], connections: [], selectedIds: first.selectedIds });
        expect(allocate).not.toHaveBeenCalled();
        const archive = saved.find((node) => node.metadata?.storyWorkflow?.role === "character")!;
        expect(JSON.parse(archive.metadata!.storyWorkflow!.sourceProfileJson!)).toEqual(payload().characters[0]);
    });

    it("ignores unreferenced archives and keeps an oversized video plan in text without truncating it", () => {
        const value = payload(); value.characters.push({ ...value.characters[0], id: "unused", name: "其他人" });
        value.formattedPrompt = "完整分镜".repeat(3000);
        const result = build(value);
        expect(result.nodes.some((node) => node.metadata?.storyWorkflow?.sourceId === "unused")).toBe(false);
        expect(result.nodes.some((node) => node.metadata?.generationMode === "video")).toBe(false);
        expect(result.nodes.find((node) => node.metadata?.storyWorkflow?.role === "storyboard")?.metadata?.content).toBe(value.formattedPrompt);
        expect(result.warnings.join(" ")).toContain("超过视频提示词长度");
    });

    it("rejects executable links, HTML, external node tokens and unknown archive references before allocating any nodes", () => {
        for (const unsafe of ["[打开](javascript:alert(1))", "<script>run()</script>", "data:text/html;base64,abc", "@[node:another-project]"]) {
            const value = payload(); value.script = unsafe;
            const allocate = vi.fn(() => "never");
            expect(() => createStoryWorkflowImport(value, [], models(), { x: 0, y: 0 }, allocate)).toThrow("脚本、链接或外部节点引用");
            expect(allocate).not.toHaveBeenCalled();
        }
        const unknown = payload(); unknown.shots[0].characters[0].characterId = "missing";
        expect(() => readStoryWorkflowPayload(unknown)).toThrow("角色缺失");
        const offscreen = payload(); offscreen.shots[0].characters = [];
        expect(() => readStoryWorkflowPayload(offscreen)).toThrow("发言角色必须出镜");
        const scene = payload(); scene.scenes = [];
        expect(() => readStoryWorkflowPayload(scene)).toThrow("缺失的场景");
    });

    it("rejects malformed timelines, duplicate archive IDs, oversized commands and invalid placement", () => {
        const timing = payload(); timing.shots[1].end = 7;
        expect(() => readStoryWorkflowPayload(timing)).toThrow("镜头时间");
        const few = payload(); few.shots.pop(); expect(() => readStoryWorkflowPayload(few)).toThrow("五个连续");
        const duplicate = payload(); duplicate.props[0].id = duplicate.characters[0].id;
        expect(() => readStoryWorkflowPayload(duplicate)).toThrow("档案标识重复");
        expect(() => readStoryWorkflowPayload({ ...payload(), unused: "字".repeat(512_000) })).toThrow("500 Ki");
        expect(() => createStoryWorkflowImport(payload(), [], models(), { x: NaN, y: 0 })).toThrow("画布位置无效");
    });

    it("allocates unique node and connection IDs across multiple imports", () => {
        const first = build();
        const allIds = new Set([...first.nodes.map((node) => node.id), ...first.connections.map((edge) => edge.id)]);
        expect(allIds.size).toBe(first.nodes.length + first.connections.length);
        expect(first.connections.every((edge) => allIds.has(edge.fromNodeId) && allIds.has(edge.toNodeId))).toBe(true);
    });
});
