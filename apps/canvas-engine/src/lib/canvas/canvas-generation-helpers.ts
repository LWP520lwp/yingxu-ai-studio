import { defaultConfig, resolveModelForCapability, type AiConfig } from "@/stores/use-config-store";
import i18n from "@/i18n";
import { ensureImagePreview, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";
import { imageMetadata, referenceUrl } from "@/lib/canvas/canvas-node-factory";
import type { NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import type { CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import type { ReferenceImage } from "@/types/image";
import { CanvasNodeType, type CanvasAssistantSession, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

const IMAGE_RESTORE_CONCURRENCY = 4;

function mapConcurrent<T, R>(items: T[], concurrency: number, map: (item: T, index: number) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let cursor = 0;
    const workerCount = Math.min(items.length, Math.max(1, concurrency));
    return Promise.all(Array.from({ length: workerCount }, async () => {
        while (cursor < items.length) {
            const index = cursor++;
            results[index] = await map(items[index], index);
        }
    })).then(() => results);
}

function warmImagePreview(storageKey?: string) {
    if (storageKey) void ensureImagePreview(storageKey).catch(() => undefined);
}

export function imageExtension(dataUrl: string) {
    const mimeType = dataUrl.match(/^data:image\/([^;,]+)/i)?.[1] || dataUrl.match(/image\/([^;,?]+)/i)?.[1];
    return mimeType?.toLowerCase() || "png";
}

export function audioExtension(mimeType?: string) {
    const mime = (mimeType || "").toLowerCase();
    if (mime.includes("wav")) return "wav";
    if (mime.includes("opus")) return "opus";
    if (mime.includes("aac")) return "aac";
    if (mime.includes("flac")) return "flac";
    if (mime.includes("pcm")) return "pcm";
    if (mime.includes("webm")) return "webm";
    if (mime.includes("mp4")) return "m4a";
    if (mime.includes("ogg")) return "ogg";
    return "mp3";
}

export function generationReferenceUrls(context: { referenceImages: ReferenceImage[]; referenceVideos: Array<{ storageKey?: string; url?: string }>; referenceAudios?: Array<{ storageKey?: string; url?: string }> }) {
    const candidates = [
        ...context.referenceImages.map(referenceUrl),
        ...context.referenceVideos.map((video) => video.storageKey || video.url),
        ...(context.referenceAudios || []).map((audio) => audio.storageKey || audio.url),
    ];
    return [...new Set(candidates.filter((url): url is string => typeof url === "string" && url.length > 0))];
}

export async function resolveMetadataReferences(metadata: CanvasNodeMetadata) {
    if (metadata.generationType !== "edit") return [];
    if (!metadata.references?.length) return null;
    const references = await Promise.all(metadata.references.map(async (url, index) => {
        const isStoredImage = url.startsWith("image:");
        const dataUrl = isStoredImage ? await resolveImageUrl(url, "") : url;
        return dataUrl ? { id: `${index}`, name: `reference-${index}.png`, type: "image/png", dataUrl, storageKey: isStoredImage ? url : undefined } : null;
    }));
    return references.every(Boolean) ? references as ReferenceImage[] : null;
}

async function hydrateImageRecord(image: NonNullable<CanvasNodeMetadata["images"]>[number]) {
    if (!image.storageKey) return image;
    warmImagePreview(image.storageKey);
    return { ...image, content: await resolveImageUrl(image.storageKey, image.content || "") };
}

async function hydrateImageRecords(images: NonNullable<CanvasNodeMetadata["images"]>) {
    const hydrated = [];
    for (const image of images) hydrated.push(await hydrateImageRecord(image));
    return hydrated;
}

async function hydrateCanvasNode(node: CanvasNodeData): Promise<CanvasNodeData> {
    const metadata = node.metadata;
    if (!metadata) return node;

    if ((node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) && metadata.storageKey) {
        return { ...node, metadata: { ...metadata, content: await resolveMediaUrl(metadata.storageKey, metadata.content) } };
    }
    if (node.type !== CanvasNodeType.Image) return node;

    const originalImages = metadata.images || [];
    const images = await hydrateImageRecords(originalImages);
    const imagesChanged = images.some((image, index) => image !== originalImages[index]);

    if (metadata.storageKey) {
        warmImagePreview(metadata.storageKey);
        const content = await resolveImageUrl(metadata.storageKey, metadata.content || "");
        return { ...node, metadata: { ...metadata, content, images } };
    }

    if (metadata.content?.startsWith("data:image/")) {
        const uploaded = await uploadImage(metadata.content);
        return { ...node, metadata: { ...metadata, ...imageMetadata(uploaded), images } };
    }

    return imagesChanged ? { ...node, metadata: { ...metadata, images } } : node;
}

export async function hydrateCanvasImages(nodes: CanvasNodeData[]) {
    return mapConcurrent(nodes, IMAGE_RESTORE_CONCURRENCY, hydrateCanvasNode);
}

async function hydrateAssistantItem<T extends { dataUrl?: string; storageKey?: string }>(item: T): Promise<T> {
    if (item.storageKey) return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl || "") };
    if (item.dataUrl?.startsWith("data:image/")) {
        const uploaded = await uploadImage(item.dataUrl);
        return { ...item, dataUrl: uploaded.url, storageKey: uploaded.storageKey };
    }
    return item;
}

export async function hydrateAssistantImages(sessions: CanvasAssistantSession[]) {
    return Promise.all(sessions.map(async (session) => ({
        ...session,
        messages: await Promise.all(session.messages.map(async (message) => ({
            ...message,
            references: await Promise.all((message.references || []).map(hydrateAssistantItem)),
        }))),
    })));
}

export function getGenerationCount(count: string) {
    return Math.max(1, Math.min(15, Math.floor(Math.abs(Number(count)) || 1)));
}

export function getInputSummary(inputs: NodeGenerationInput[]) {
    const resources = [...new Map(inputs.flatMap((input) => input.type === "group" ? input.children : [input]).map((input) => [input.nodeId, input])).values()];
    return {
        textCount: resources.filter((input) => input.type === "text").length,
        imageCount: resources.filter((input) => input.type === "image").length,
        videoCount: resources.filter((input) => input.type === "video").length,
        audioCount: resources.filter((input) => input.type === "audio").length,
    };
}

export function buildGenerationConfig(config: AiConfig, node: CanvasNodeData | undefined, mode: CanvasNodeGenerationMode): AiConfig {
    const metadata = node?.metadata;
    const videoSkillId = mode === "video" ? metadata?.videoSkillId ?? metadata?.skillId : undefined;
    return {
        ...config,
        model: resolveModelForCapability(config, metadata?.model, mode),
        reasoningEffort: metadata?.reasoningEffort || config.reasoningEffort || defaultConfig.reasoningEffort,
        quality: metadata?.quality || config.quality || defaultConfig.quality,
        size: metadata?.size || config.size || defaultConfig.size,
        background: metadata?.background ?? config.background ?? defaultConfig.background,
        videoSeconds: metadata?.seconds || config.videoSeconds || defaultConfig.videoSeconds,
        vquality: metadata?.vquality || config.vquality || defaultConfig.vquality,
        videoGenerateAudio: metadata?.generateAudio || config.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: metadata?.watermark || config.videoWatermark || defaultConfig.videoWatermark,
        videoMode: metadata?.videoMode || config.videoMode || defaultConfig.videoMode,
        videoFramesReversed: metadata?.videoFramesReversed ?? false,
        videoSkillId,
        videoSkillVersion: mode === "video" ? metadata?.videoSkillVersion ?? metadata?.skillVersion : undefined,
        videoSkillReviewRequired: mode === "video" && Boolean(videoSkillId) && metadata?.videoSkillInputMode !== "instruction",
        appliedSkillId: mode === "image" ? metadata?.skillId : undefined,
        appliedSkillVersion: mode === "image" ? metadata?.skillVersion : undefined,
        audioVoice: metadata?.audioVoice || config.audioVoice || defaultConfig.audioVoice,
        audioFormat: metadata?.audioFormat || config.audioFormat || defaultConfig.audioFormat,
        audioSpeed: metadata?.audioSpeed || config.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: metadata?.audioInstructions || config.audioInstructions || defaultConfig.audioInstructions,
        count: String(metadata?.count || (mode === "image" ? config.canvasImageCount || config.count : config.count) || defaultConfig.count),
    };
}

export function hasResumableVideoTask(node: CanvasNodeData) {
    return node.type === CanvasNodeType.Video && Boolean(node.metadata?.videoTaskId) && !node.metadata?.content;
}

export function resetInterruptedGeneration(nodes: CanvasNodeData[]) {
    const interrupted = i18n.t("canvas.generation.interrupted");
    return nodes.map((node) => {
        if (node.metadata?.status !== "loading" || hasResumableVideoTask(node)) return node;
        return {
            ...node,
            metadata: {
                ...node.metadata,
                status: "error" as const,
                errorDetails: interrupted,
                images: node.metadata.images?.map((image) => image.status === "loading" ? { ...image, status: "error" as const, errorDetails: interrupted } : image),
                texts: node.metadata.texts?.map((text) => text.status === "loading" ? { ...text, status: "error" as const, errorDetails: interrupted } : text),
            },
        };
    });
}

export function isGenerationCanceled(error: unknown) {
    return error instanceof Error && (error.message === i18n.t("common.requestCanceled") || error.name === "AbortError");
}

export function findRetrySourceNode(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const incoming = new Map<string, string[]>();
    for (const connection of connections) {
        const sources = incoming.get(connection.toNodeId);
        if (sources) sources.push(connection.fromNodeId);
        else incoming.set(connection.toNodeId, [connection.fromNodeId]);
    }

    const visited = new Set([nodeId]);
    const queue = [...(incoming.get(nodeId) || [])];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const id = queue[cursor];
        if (visited.has(id)) continue;
        visited.add(id);
        const node = byId.get(id);
        if (node?.type === CanvasNodeType.Config) return node;
        for (const sourceId of incoming.get(id) || []) if (!visited.has(sourceId)) queue.push(sourceId);
    }
    return null;
}

export function sourceNodeReferenceImages(node: CanvasNodeData | null) {
    if (!node || node.type !== CanvasNodeType.Image || !node.metadata?.content) return [];
    return [{
        id: node.id,
        name: `${node.title || node.id}.png`,
        type: node.metadata.mimeType || "image/png",
        dataUrl: node.metadata.content,
        storageKey: node.metadata.storageKey,
    }];
}

const AUDIO_EXTENSIONS = /\.(aac|aif|aiff|alac|flac|m4a|mid|midi|mp3|oga|ogg|opus|wav|webm)$/i;

export function isAudioFile(file: File) {
    return file.type.toLowerCase().startsWith("audio/") || AUDIO_EXTENSIONS.test(file.name);
}

export function buildAngleLabel(params: CanvasImageAngleParams) {
    const horizontal = params.horizontalAngle === 0 ? i18n.t("canvas.generation.front") : params.horizontalAngle > 0 ? i18n.t("canvas.generation.rotateRight", { angle: params.horizontalAngle }) : i18n.t("canvas.generation.rotateLeft", { angle: Math.abs(params.horizontalAngle) });
    const pitch = params.pitchAngle === 0 ? i18n.t("canvas.generation.level") : params.pitchAngle > 0 ? i18n.t("canvas.generation.topDown", { angle: params.pitchAngle }) : i18n.t("canvas.generation.lowAngle", { angle: Math.abs(params.pitchAngle) });
    return i18n.t("canvas.generation.angleLabel", { horizontal, pitch, distance: params.cameraDistance.toFixed(1), lens: i18n.t(params.wideAngle ? "canvas.editors.wide" : "canvas.editors.standard") });
}

export function buildAnglePrompt(params: CanvasImageAngleParams) {
    return i18n.t("canvas.generation.anglePrompt", { angle: buildAngleLabel(params) });
}
