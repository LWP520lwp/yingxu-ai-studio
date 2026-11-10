import type { StoryApplyPayload, StoryCharacter, StoryScene, StoryProp } from "../../../web/src/storyWorkflowModel";
import { CanvasNodeType, type CanvasNodeData, type CanvasConnection, type CanvasNodeMetadata, type Position } from "@/types/canvas";
import type { PlatformModels, PlatformModel } from "./rpc";

type Provenance = NonNullable<CanvasNodeMetadata["storyWorkflow"]>;
export type StoryWorkflowImport = { nodes: CanvasNodeData[]; connections: CanvasConnection[]; selectedIds: string[]; duplicate: boolean; warnings: string[] };
function invalid(detail: string): never { throw new Error(`连续分镜无法应用：${detail}`); }
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
function text(value: unknown, maximum: number, empty = false): asserts value is string {
    if (typeof value !== "string" || value.length > maximum || (!empty && !value.trim())) invalid("文字缺失或超过长度上限");
}
function id(value: unknown): asserts value is string { if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) invalid("档案或分镜标识无效"); }
function list(value: unknown, maximum: number): asserts value is unknown[] { if (!Array.isArray(value) || value.length > maximum) invalid("档案或镜头数量不正确"); }

/** No arbitrary node metadata, URLs, HTML, model calls, or scripts cross this command boundary. */
export function readStoryWorkflowPayload(raw: unknown): StoryApplyPayload {
    if (!object(raw)) invalid("需要完整的分镜数据");
    let serialized: string;
    try { serialized = JSON.stringify(raw); } catch { return invalid("数据无法序列化"); }
    if (serialized.length > 512_000) invalid("分镜数据超过 500 Ki 字符");
    const inspect = (value: unknown, depth: number) => {
        if (depth > 12) invalid("数据层级过深");
        if (typeof value === "string") {
            if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) || /(?:javascript|vbscript|data)\s*:|<\s*\/?\s*(?:script|iframe|object|embed|svg)\b|@\[\s*node\s*:/i.test(value)) invalid("内容包含不支持的脚本、链接或外部节点引用");
        } else if (Array.isArray(value)) value.forEach((item) => inspect(item, depth + 1));
        else if (object(value)) Object.values(value).forEach((item) => inspect(item, depth + 1));
    };
    inspect(raw, 0);
    id(raw.segmentId); text(raw.title, 240); text(raw.script, 6000); text(raw.formattedPrompt, 120_000);
    list(raw.characters, 30); list(raw.scenes, 40); list(raw.props, 40); list(raw.shots, 5);
    if (raw.shots.length !== 5) invalid("必须是五个连续的 3 秒镜头");
    const allIds = new Set<string>();
    for (const [kind, values] of [["character", raw.characters], ["scene", raw.scenes], ["prop", raw.props]] as const) {
        for (const value of values) {
            if (!object(value)) invalid("档案格式无效");
            id(value.id); text(value.name, 100); text(value.imagePrompt, 12_000);
            if (allIds.has(value.id)) invalid("档案标识重复"); allIds.add(value.id);
            if (kind === "character") {
                if (!object(value.core) || !object(value.clothing) || typeof value.locked !== "boolean") invalid("角色档案不完整");
                for (const key of ["age", "country", "era", "gender", "features", "face", "hairColor", "hairStyle", "eyeColor", "build"]) text(value.core[key], 140);
                for (const key of ["upper", "lower", "shoes", "accessories"]) text(value.clothing[key], 180);
                text(value.voice, 240); text(value.personality, 300); text(value.threeViewPrompt, 12_000);
                list(value.aliases, 30); value.aliases.forEach((alias) => text(alias, 80));
                list(value.assumptions, 20); value.assumptions.forEach((assumption) => text(assumption, 180));
            } else if (kind === "scene") {
                for (const key of ["time", "weather", "lighting", "space", "elements"]) text(value[key], 400);
                list(value.aliases, 20); value.aliases.forEach((alias) => text(alias, 100));
            } else for (const key of ["material", "size", "appearance"]) text(value[key], 400);
        }
    }
    const payload = raw as unknown as StoryApplyPayload;
    const characters = new Set(payload.characters.map((value) => value.id));
    const scenes = new Set(payload.scenes.map((value) => value.id));
    const props = new Set(payload.props.map((value) => value.id));
    payload.shots.forEach((shot, index) => {
        if (!object(shot) || shot.start !== index * 3 || shot.end !== (index + 1) * 3 || shot.duration !== 3 || shot.narration !== "无") invalid("镜头时间必须是 0–3、3–6、6–9、9–12、12–15 秒，旁白为无");
        for (const key of ["shotType", "camera", "visibleAction", "sound", "sceneDetail", "imagePrompt", "videoPrompt"] as const) text(shot[key], key.endsWith("Prompt") ? 12_000 : 700);
        id(shot.sceneId); if (!scenes.has(shot.sceneId)) invalid("镜头引用了缺失的场景");
        list(shot.characters, 30); list(shot.dialogue, 3); list(shot.propIds, 20);
        const present = new Set<string>();
        for (const actor of shot.characters) {
            if (!object(actor)) invalid("镜头角色状态无效");
            id(actor.characterId); if (!characters.has(actor.characterId) || present.has(actor.characterId)) invalid("镜头角色缺失或重复");
            present.add(actor.characterId);
            for (const key of ["position", "posture", "action", "wardrobe"] as const) text(actor[key], 240);
        }
        let speech = 0;
        for (const line of shot.dialogue) {
            if (!object(line)) invalid("台词格式无效");
            id(line.characterId); text(line.text, 24); if (!present.has(line.characterId)) invalid("发言角色必须出镜"); speech += [...line.text].length;
        }
        if (speech > 24) invalid("3 秒镜头的台词过长");
        for (const prop of shot.propIds) { id(prop); if (!props.has(prop)) invalid("镜头引用了缺失的道具"); }
    });
    return payload;
}

/** Unknown duration support is deliberately insufficient to promise a 15-second generation. */
export function storyVideoModel(models: readonly PlatformModel[]) {
    return models.find((model) => model.available && (model.caps?.fixedDuration === 15 || !model.caps?.fixedDuration && Array.isArray(model.caps?.durations) && model.caps.durations.includes(15)));
}

/** Builds inert editable nodes only; the caller commits them atomically and saves separately. */
export function createStoryWorkflowImport(raw: unknown, existing: readonly CanvasNodeData[], models: PlatformModels, position: Position,
    newId: () => string = () => crypto.randomUUID()): StoryWorkflowImport {
    const payload = readStoryWorkflowPayload(raw);
    const prior = existing.filter((node) => node.metadata?.storyWorkflow?.segmentId === payload.segmentId);
    if (prior.length) return { nodes: [], connections: [], selectedIds: prior.map((node) => node.id), duplicate: true, warnings: [] };
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) invalid("画布位置无效");
    const nodes: CanvasNodeData[] = [], connections: CanvasConnection[] = [], warnings: string[] = [];
    const usedIds = new Set(existing.map((node) => node.id));
    const nextId = () => { const value = `story-${newId()}`; id(value); if (usedIds.has(value)) invalid("节点标识重复，请重试"); usedIds.add(value); return value; };
    const rightEdge = existing.reduce((right, node) => Math.max(right, node.position.x + node.width), position.x - 380);
    const x = rightEdge + 160, y = position.y - 180;
    const add = (type: CanvasNodeType, title: string, point: Position, metadata: CanvasNodeMetadata, provenance: Omit<Provenance, "schemaVersion" | "segmentId">) => {
        const node: CanvasNodeData = { id: nextId(), type, title: title.slice(0, 200), position: point, width: type === CanvasNodeType.Text ? 440 : 340, height: type === CanvasNodeType.Text ? 360 : 360,
            metadata: { ...metadata, storyWorkflow: { schemaVersion: 1, segmentId: payload.segmentId, ...provenance } } };
        nodes.push(node); return node;
    };
    const connect = (from: CanvasNodeData, to: CanvasNodeData) => connections.push({ id: nextId(), fromNodeId: from.id, toNodeId: to.id });
    const script = add(CanvasNodeType.Text, `${payload.title} · 原剧本`, { x, y }, { content: payload.script, status: "success" }, { role: "script" });
    const videoModel = storyVideoModel(models.video);
    const storyboard = add(CanvasNodeType.Text, `${payload.title} · 完整15秒分镜`, { x: x + 560, y }, { content: payload.formattedPrompt, status: "success" }, { role: "storyboard", shotsJson: JSON.stringify(payload.shots), targetDuration: 15, pendingVideo: !videoModel });
    storyboard.height = 660; connect(script, storyboard);
    if (videoModel && payload.formattedPrompt.length <= 11_500) {
        const prompt = `@[node:${storyboard.id}]`;
        const width = Number(videoModel.caps?.fixedWidth) || 1280, height = Number(videoModel.caps?.fixedHeight) || 720;
        const video = add(CanvasNodeType.Config, `${payload.title} · 15秒视频`, { x: x + 1120, y }, { generationMode: "video", model: `platform::${videoModel.id}`, prompt, composerContent: prompt, status: "idle",
            seconds: "15", size: `${width}x${height}`, vquality: String(height), videoMode: "auto", generateAudio: "auto", watermark: "auto", videoSkillId: "", videoSkillVersion: "", videoSkillInputMode: "instruction" }, { role: "video-config", targetDuration: 15 });
        connect(storyboard, video);
    } else {
        storyboard.metadata!.storyWorkflow!.pendingVideo = true;
        warnings.push(videoModel ? "完整分镜超过视频提示词长度，已保留全文，请精简后生成。" : "当前模型未明确支持15秒视频，完整分镜已保留为文字。接入支持15秒的模型后可从该文字创建视频。" );
    }
    const imageModel = models.image.find((model) => model.available);
    if (!imageModel) warnings.push("生图配置已保留，接入可用图像模型并选择模型后再生成。" );
    const usedCharacters = new Set(payload.shots.flatMap((shot) => shot.characters.map((actor) => actor.characterId)));
    const usedScenes = new Set(payload.shots.map((shot) => shot.sceneId));
    const usedProps = new Set(payload.shots.flatMap((shot) => shot.propIds));
    const assets: { role: "character" | "scene" | "prop"; profile: StoryCharacter | StoryScene | StoryProp }[] = [
        ...payload.characters.filter((value) => usedCharacters.has(value.id)).map((profile) => ({ role: "character" as const, profile })),
        ...payload.scenes.filter((value) => usedScenes.has(value.id)).map((profile) => ({ role: "scene" as const, profile })),
        ...payload.props.filter((value) => usedProps.has(value.id)).map((profile) => ({ role: "prop" as const, profile })),
    ];
    assets.forEach(({ role, profile }, index) => {
        const point = { x: x + index % 2 * 960, y: y + 820 + Math.floor(index / 2) * 500 };
        const kind = { character: "角色", scene: "场景", prop: "道具" }[role];
        const profileJson = JSON.stringify(profile);
        const content = role === "character" ? `${profile.name}\n${profile.imagePrompt}\n\n三视图：\n${(profile as StoryCharacter).threeViewPrompt}\n\n固定音色：${(profile as StoryCharacter).voice}\n待核对：${(profile as StoryCharacter).assumptions.join("；") || "无"}` : `${profile.name}\n${profile.imagePrompt}`;
        const archive = add(CanvasNodeType.Text, `${kind}档案 · ${profile.name}`, point, { content, status: "success" }, { role, sourceId: profile.id, sourceProfileJson: profileJson });
        const width = Number(imageModel?.caps?.fixedWidth) || (role === "scene" ? 1536 : 1024), height = Number(imageModel?.caps?.fixedHeight) || (role === "scene" ? 864 : 1024);
        const image = add(CanvasNodeType.Config, `${kind}生图 · ${profile.name}`, { x: point.x + 500, y: point.y }, { generationMode: "image", model: imageModel ? `platform::${imageModel.id}` : "", prompt: profile.imagePrompt,
            composerContent: profile.imagePrompt, generationType: "generation", count: 1, size: `${width}x${height}`, quality: "auto", background: "auto", status: "idle" }, { role: "image-config", sourceId: profile.id, sourceProfileJson: profileJson });
        connect(storyboard, archive); connect(archive, image);
    });
    return { nodes, connections, selectedIds: nodes.map((node) => node.id), duplicate: false, warnings };
}
