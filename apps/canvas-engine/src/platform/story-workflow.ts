import type { StoryApplyPayload, StoryCharacter, StoryScene, StoryProp } from "../../../web/src/storyWorkflowModel";
import { CanvasNodeType, type CanvasNodeData, type CanvasConnection, type CanvasNodeMetadata, type Position } from "@/types/canvas";
import type { PlatformModels, PlatformModel } from "./rpc";

type WorkflowOrigin = NonNullable<CanvasNodeMetadata["storyWorkflow"]>;
export type StoryWorkflowImport = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedIds: string[];
    duplicate: boolean;
    warnings: string[];
};

function reject(detail: string): never {
    throw new Error(`连续分镜无法应用：${detail}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireText(value: unknown, limit: number, allowEmpty = false): asserts value is string {
    if (typeof value !== "string" || value.length > limit || (!allowEmpty && !value.trim())) reject("文字缺失或超过长度上限");
}

function requireId(value: unknown): asserts value is string {
    if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) reject("档案或分镜标识无效");
}

function requireList(value: unknown, limit: number): asserts value is unknown[] {
    if (!Array.isArray(value) || value.length > limit) reject("档案或镜头数量不正确");
}

function inspectContent(value: unknown, depth = 0): void {
    if (depth > 12) reject("数据层级过深");
    if (typeof value === "string") {
        const controlCharacter = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;
        const executableMarkup = /(?:javascript|vbscript|data)\s*:|<\s*\/?\s*(?:script|iframe|object|embed|svg)\b|@\[\s*node\s*:/i;
        if (controlCharacter.test(value) || executableMarkup.test(value)) reject("内容包含不支持的脚本、链接或外部节点引用");
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((entry) => inspectContent(entry, depth + 1));
    } else if (isRecord(value)) {
        Object.values(value).forEach((entry) => inspectContent(entry, depth + 1));
    }
}

function validateProfiles(payload: Record<string, unknown>) {
    requireList(payload.characters, 30);
    requireList(payload.scenes, 40);
    requireList(payload.props, 40);
    const ids = new Set<string>();
    const groups = [
        { values: payload.characters, kind: "character" },
        { values: payload.scenes, kind: "scene" },
        { values: payload.props, kind: "prop" },
    ] as const;

    for (const { values, kind } of groups) {
        for (const entry of values) {
            if (!isRecord(entry)) reject("档案格式无效");
            requireId(entry.id);
            requireText(entry.name, 100);
            requireText(entry.imagePrompt, 12_000);
            if (ids.has(entry.id)) reject("档案标识重复");
            ids.add(entry.id);

            if (kind === "character") {
                if (!isRecord(entry.core) || !isRecord(entry.clothing) || typeof entry.locked !== "boolean") reject("角色档案不完整");
                for (const key of ["age", "country", "era", "gender", "features", "face", "hairColor", "hairStyle", "eyeColor", "build"]) requireText(entry.core[key], 140);
                for (const key of ["upper", "lower", "shoes", "accessories"]) requireText(entry.clothing[key], 180);
                requireText(entry.voice, 240);
                requireText(entry.personality, 300);
                requireText(entry.threeViewPrompt, 12_000);
                requireList(entry.aliases, 30);
                entry.aliases.forEach((alias) => requireText(alias, 80));
                requireList(entry.assumptions, 20);
                entry.assumptions.forEach((assumption) => requireText(assumption, 180));
            } else if (kind === "scene") {
                for (const key of ["time", "weather", "lighting", "space", "elements"]) requireText(entry[key], 400);
                requireList(entry.aliases, 20);
                entry.aliases.forEach((alias) => requireText(alias, 100));
            } else {
                for (const key of ["material", "size", "appearance"]) requireText(entry[key], 400);
            }
        }
    }
}

function validateShots(payload: Record<string, unknown>) {
    requireList(payload.shots, 5);
    if (payload.shots.length !== 5) reject("必须是五个连续的 3 秒镜头");
    const characterIds = new Set((payload.characters as Array<{ id: string }>).map((item) => item.id));
    const sceneIds = new Set((payload.scenes as Array<{ id: string }>).map((item) => item.id));
    const propIds = new Set((payload.props as Array<{ id: string }>).map((item) => item.id));

    payload.shots.forEach((entry, index) => {
        if (!isRecord(entry) || entry.start !== index * 3 || entry.end !== (index + 1) * 3 || entry.duration !== 3 || entry.narration !== "无") {
            reject("镜头时间必须是 0–3、3–6、6–9、9–12、12–15 秒，旁白为无");
        }
        for (const key of ["shotType", "camera", "visibleAction", "sound", "sceneDetail", "imagePrompt", "videoPrompt"] as const) {
            requireText(entry[key], key.endsWith("Prompt") ? 12_000 : 700);
        }
        requireId(entry.sceneId);
        if (!sceneIds.has(entry.sceneId)) reject("镜头引用了缺失的场景");
        requireList(entry.characters, 30);
        requireList(entry.dialogue, 3);
        requireList(entry.propIds, 20);

        const visibleCharacters = new Set<string>();
        for (const actor of entry.characters) {
            if (!isRecord(actor)) reject("镜头角色状态无效");
            requireId(actor.characterId);
            if (!characterIds.has(actor.characterId) || visibleCharacters.has(actor.characterId)) reject("镜头角色缺失或重复");
            visibleCharacters.add(actor.characterId);
            for (const key of ["position", "posture", "action", "wardrobe"] as const) requireText(actor[key], 240);
        }

        let spokenCharacters = 0;
        for (const line of entry.dialogue) {
            if (!isRecord(line)) reject("台词格式无效");
            requireId(line.characterId);
            requireText(line.text, 24);
            if (!visibleCharacters.has(line.characterId)) reject("发言角色必须出镜");
            spokenCharacters += [...line.text].length;
        }
        if (spokenCharacters > 24) reject("3 秒镜头的台词过长");
        for (const propId of entry.propIds) {
            requireId(propId);
            if (!propIds.has(propId)) reject("镜头引用了缺失的道具");
        }
    });
}

/** Accepts only bounded, inert storyboard data before any canvas nodes are allocated. */
export function readStoryWorkflowPayload(raw: unknown): StoryApplyPayload {
    if (!isRecord(raw)) reject("需要完整的分镜数据");
    let serialized: string;
    try {
        serialized = JSON.stringify(raw);
    } catch {
        return reject("数据无法序列化");
    }
    if (serialized.length > 512_000) reject("分镜数据超过 500 Ki 字符");
    inspectContent(raw);
    requireId(raw.segmentId);
    requireText(raw.title, 240);
    requireText(raw.script, 6_000);
    requireText(raw.formattedPrompt, 120_000);
    validateProfiles(raw);
    validateShots(raw);
    return raw as unknown as StoryApplyPayload;
}

/** A 15-second target is eligible only when the provider advertises that exact duration. */
export function storyVideoModel(models: readonly PlatformModel[]) {
    return models.find((model) => {
        if (!model.available) return false;
        const caps = model.caps;
        if (caps?.fixedDuration !== undefined) return caps.fixedDuration === 15;
        return Array.isArray(caps?.durations) && caps.durations.includes(15);
    });
}

/** Produces editable, idle nodes. The host commits this batch and performs persistence separately. */
export function createStoryWorkflowImport(
    raw: unknown,
    existing: readonly CanvasNodeData[],
    models: PlatformModels,
    position: Position,
    allocateId: () => string = () => crypto.randomUUID(),
): StoryWorkflowImport {
    const payload = readStoryWorkflowPayload(raw);
    const existingSegment = existing.filter((node) => node.metadata?.storyWorkflow?.segmentId === payload.segmentId);
    if (existingSegment.length) {
        return { nodes: [], connections: [], selectedIds: existingSegment.map((node) => node.id), duplicate: true, warnings: [] };
    }
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) reject("画布位置无效");

    const nodes: CanvasNodeData[] = [];
    const connections: CanvasConnection[] = [];
    const warnings: string[] = [];
    const usedIds = new Set(existing.map((node) => node.id));
    const uniqueId = () => {
        const value = `story-${allocateId()}`;
        requireId(value);
        if (usedIds.has(value)) reject("节点标识重复，请重试");
        usedIds.add(value);
        return value;
    };
    const occupiedRight = existing.reduce((right, node) => Math.max(right, node.position.x + node.width), position.x - 380);
    const origin = { x: occupiedRight + 160, y: position.y - 180 };

    const addNode = (
        type: CanvasNodeType,
        title: string,
        at: Position,
        metadata: CanvasNodeMetadata,
        originData: Omit<WorkflowOrigin, "schemaVersion" | "segmentId">,
    ) => {
        const node: CanvasNodeData = {
            id: uniqueId(),
            type,
            title: title.slice(0, 200),
            position: at,
            width: type === CanvasNodeType.Text ? 440 : 340,
            height: 360,
            metadata: { ...metadata, storyWorkflow: { schemaVersion: 1, segmentId: payload.segmentId, ...originData } },
        };
        nodes.push(node);
        return node;
    };
    const connect = (from: CanvasNodeData, to: CanvasNodeData) => {
        connections.push({ id: uniqueId(), fromNodeId: from.id, toNodeId: to.id });
    };

    const script = addNode(CanvasNodeType.Text, `${payload.title} · 原剧本`, origin, { content: payload.script, status: "success" }, { role: "script" });
    const storyboard = addNode(CanvasNodeType.Text, `${payload.title} · 完整15秒分镜`, { x: origin.x + 560, y: origin.y }, {
        content: payload.formattedPrompt,
        status: "success",
    }, { role: "storyboard", shotsJson: JSON.stringify(payload.shots), targetDuration: 15 });
    storyboard.height = 660;
    connect(script, storyboard);

    const videoModel = storyVideoModel(models.video);
    if (videoModel && payload.formattedPrompt.length <= 11_500) {
        const prompt = `@[node:${storyboard.id}]`;
        const width = Number(videoModel.caps?.fixedWidth) || 1280;
        const height = Number(videoModel.caps?.fixedHeight) || 720;
        const video = addNode(CanvasNodeType.Config, `${payload.title} · 15秒视频`, { x: origin.x + 1_120, y: origin.y }, {
            generationMode: "video",
            model: `platform::${videoModel.id}`,
            prompt,
            composerContent: prompt,
            status: "idle",
            seconds: "15",
            size: `${width}x${height}`,
            vquality: String(height),
            videoMode: "auto",
            generateAudio: "auto",
            watermark: "auto",
            videoSkillId: "",
            videoSkillVersion: "",
            videoSkillInputMode: "instruction",
        }, { role: "video-config", targetDuration: 15 });
        connect(storyboard, video);
    } else {
        storyboard.metadata!.storyWorkflow!.pendingVideo = true;
        warnings.push(videoModel
            ? "完整分镜超过视频提示词长度，已保留全文，请精简后生成。"
            : "当前模型未明确支持15秒视频，完整分镜已保留为文字。接入支持15秒的模型后可从该文字创建视频。");
    }

    const imageModel = models.image.find((model) => model.available);
    if (!imageModel) warnings.push("生图配置已保留，接入可用图像模型并选择模型后再生成。");
    const usedCharacters = new Set(payload.shots.flatMap((shot) => shot.characters.map((actor) => actor.characterId)));
    const usedScenes = new Set(payload.shots.map((shot) => shot.sceneId));
    const usedProps = new Set(payload.shots.flatMap((shot) => shot.propIds));
    const archives: Array<{ kind: "character" | "scene" | "prop"; profile: StoryCharacter | StoryScene | StoryProp }> = [
        ...payload.characters.filter((profile) => usedCharacters.has(profile.id)).map((profile) => ({ kind: "character" as const, profile })),
        ...payload.scenes.filter((profile) => usedScenes.has(profile.id)).map((profile) => ({ kind: "scene" as const, profile })),
        ...payload.props.filter((profile) => usedProps.has(profile.id)).map((profile) => ({ kind: "prop" as const, profile })),
    ];

    archives.forEach(({ kind, profile }, index) => {
        const point = { x: origin.x + (index % 2) * 960, y: origin.y + 820 + Math.floor(index / 2) * 500 };
        const label = { character: "角色", scene: "场景", prop: "道具" }[kind];
        const profileJson = JSON.stringify(profile);
        const content = kind === "character"
            ? (() => {
                const character = profile as StoryCharacter;
                return `${character.name}\n${character.imagePrompt}\n\n三视图：\n${character.threeViewPrompt}\n\n固定音色：${character.voice}\n待核对：${character.assumptions.join("；") || "无"}`;
            })()
            : `${profile.name}\n${profile.imagePrompt}`;
        const archive = addNode(CanvasNodeType.Text, `${label}档案 · ${profile.name}`, point, { content, status: "success" }, {
            role: kind,
            sourceId: profile.id,
            sourceProfileJson: profileJson,
        });
        const width = Number(imageModel?.caps?.fixedWidth) || (kind === "scene" ? 1536 : 1024);
        const height = Number(imageModel?.caps?.fixedHeight) || (kind === "scene" ? 864 : 1024);
        const image = addNode(CanvasNodeType.Config, `${label}生图 · ${profile.name}`, { x: point.x + 500, y: point.y }, {
            generationMode: "image",
            model: imageModel ? `platform::${imageModel.id}` : "",
            prompt: profile.imagePrompt,
            composerContent: profile.imagePrompt,
            generationType: "generation",
            count: 1,
            size: `${width}x${height}`,
            quality: "auto",
            background: "auto",
            status: "idle",
        }, { role: "image-config", sourceId: profile.id, sourceProfileJson: profileJson });
        connect(storyboard, archive);
        connect(archive, image);
    });

    return { nodes, connections, selectedIds: nodes.map((node) => node.id), duplicate: false, warnings };
}
