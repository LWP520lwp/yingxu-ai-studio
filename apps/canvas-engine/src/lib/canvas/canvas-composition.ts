import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { resolveMediaUrl } from "@/services/file-storage";
import { createZip } from "@/lib/zip";

export const COMPOSITION_NODE_TYPE = "platform:composition";

export type CompositionClip = {
    id: string;
    sourceNodeId: string;
    title: string;
    url: string;
    storageKey?: string;
    mimeType?: string;
    durationMs?: number;
    startMs: number;
    endMs: number | null;
    volume: number;
};

export type CanvasComposition = { version: 1; clips: CompositionClip[] };

export function compositionVideos(nodes: CanvasNodeData[]) {
    return nodes.filter((node) => node.type === CanvasNodeType.Video && Boolean(node.metadata?.content));
}

function newClipId() {
    return globalThis.crypto?.randomUUID?.() || `clip-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createComposition(nodes: CanvasNodeData[]): CanvasComposition {
    return {
        version: 1,
        clips: compositionVideos(nodes).map((node) => ({
            id: newClipId(),
            sourceNodeId: node.id,
            title: node.title || "视频片段",
            url: node.metadata!.content!,
            storageKey: node.metadata?.storageKey,
            mimeType: node.metadata?.mimeType,
            durationMs: node.metadata?.durationMs,
            startMs: 0,
            endMs: null,
            volume: 1,
        })),
    };
}

function finiteNumber(value: number, fallback: number) {
    return Number.isFinite(value) ? value : fallback;
}

export function normalizeClip(clip: CompositionClip): CompositionClip {
    const durationMs = typeof clip.durationMs === "number" && Number.isFinite(clip.durationMs) && clip.durationMs > 0 ? clip.durationMs : undefined;
    const minimumSegment = durationMs ? Math.min(100, durationMs) : 100;
    const latestStart = durationMs ? Math.max(0, durationMs - minimumSegment) : Infinity;
    const startMs = Math.min(Math.max(finiteNumber(clip.startMs, 0), 0), latestStart);
    const endMs = clip.endMs === null || !Number.isFinite(clip.endMs)
        ? null
        : Math.min(Math.max(clip.endMs, startMs + minimumSegment), durationMs ?? Infinity);
    const volume = Math.min(1, Math.max(0, finiteNumber(clip.volume, 1)));
    return { ...clip, durationMs, startMs, endMs, volume };
}

export function clipDurationMs(clip: CompositionClip) {
    const safe = normalizeClip(clip);
    return Math.max(0, (safe.endMs ?? safe.durationMs ?? safe.startMs) - safe.startMs);
}

export function moveCompositionClip(composition: CanvasComposition, index: number, delta: number): CanvasComposition {
    const target = index + delta;
    if (!Number.isInteger(index) || !Number.isInteger(delta) || index < 0 || index >= composition.clips.length || target < 0 || target >= composition.clips.length) return composition;
    const clips = [...composition.clips];
    [clips[index], clips[target]] = [clips[target], clips[index]];
    return { ...composition, clips };
}

export function formatCompositionTime(milliseconds: number) {
    const deciseconds = Math.round(Math.max(0, finiteNumber(milliseconds, 0)) / 100);
    const minutes = Math.floor(deciseconds / 600);
    const seconds = (deciseconds % 600) / 10;
    return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}

function offlinePlayer(composition: CanvasComposition) {
    const serialized = JSON.stringify(composition).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>合成预览</title><style>body{margin:0;background:#111318;color:#edf0f6;font:16px system-ui}main{max-width:1100px;margin:36px auto;padding:20px}video{width:100%;max-height:70vh;background:#000;border-radius:14px}button{padding:10px 16px;margin:10px 8px 10px 0;cursor:pointer}p{color:#bcc2ce}</style><main><h1>视频合成预览</h1><video controls playsinline></video><div><button id="previous">上一段</button><button id="next">下一段</button><button id="restart">从头播放</button></div><p id="label"></p><p>本包包含原始素材与选段编排；浏览器按顺序播放，未渲染为单个 MP4。</p></main><script>const composition=${serialized};const video=document.querySelector('video'),label=document.querySelector('#label');let index=0,advance=false;function load(i,play){index=i;advance=play;const c=composition.clips[index];if(!c){video.pause();label.textContent='播放结束';return}video.src=c.url;video.volume=c.volume;label.textContent=(index+1)+' / '+composition.clips.length+' · '+c.title;}video.addEventListener('loadedmetadata',()=>{const c=composition.clips[index];if(!c)return;video.currentTime=Math.min(c.startMs/1000,Math.max(0,video.duration-.1));if(advance)video.play().catch(()=>{label.textContent+=' · 请点击播放';});});function next(){if(index+1<composition.clips.length)load(index+1,true);else{video.pause();label.textContent+=' · 播放结束';}}video.addEventListener('ended',next);video.addEventListener('timeupdate',()=>{const c=composition.clips[index];if(c&&c.endMs!==null&&video.currentTime>=c.endMs/1000&&!video.paused){video.pause();next();}});video.addEventListener('error',()=>{label.textContent+=' · 素材无法播放，请确认完整解压了 ZIP';});document.querySelector('#previous').onclick=()=>load(Math.max(0,index-1),true);document.querySelector('#next').onclick=next;document.querySelector('#restart').onclick=()=>load(0,true);load(0,false);</script></html>`;
}

function videoExtension(mimeType: string, fallback?: string) {
    const mime = mimeType.toLowerCase();
    if (mime.includes("webm")) return "webm";
    if (mime.includes("quicktime")) return "mov";
    if (mime.includes("ogg")) return "ogv";
    if (mime.includes("mpeg")) return "mpeg";
    if (fallback?.toLowerCase().includes("webm")) return "webm";
    if (fallback?.toLowerCase().includes("quicktime")) return "mov";
    return "mp4";
}

/** The archive stores media bytes so it can be played without expiring service URLs. */
export async function exportCompositionPackage(composition: CanvasComposition, signal?: AbortSignal) {
    if (!composition.clips.length) throw new Error("没有可以导出的片段");
    const files: { name: string; data: BlobPart }[] = [];
    const clips: CompositionClip[] = [];
    const pathByUrl = new Map<string, string>();

    for (const [index, original] of composition.clips.entries()) {
        signal?.throwIfAborted();
        const clip = normalizeClip(original);
        const sourceUrl = await resolveMediaUrl(clip.storageKey, clip.url);
        let path = pathByUrl.get(sourceUrl);
        if (!path) {
            const response = await fetch(sourceUrl, { signal });
            if (!response.ok) throw new Error(`无法读取“${clip.title}”，请确认素材仍可访问`);
            const blob = await response.blob();
            if (!blob.size || (blob.type && !blob.type.startsWith("video/") && blob.type !== "application/octet-stream")) {
                throw new Error(`“${clip.title}”不是可导出的视频素材`);
            }
            const mimeType = blob.type || clip.mimeType || "video/mp4";
            path = `media/clip-${String(index + 1).padStart(2, "0")}.${videoExtension(mimeType, clip.mimeType)}`;
            files.push({ name: path, data: blob });
            pathByUrl.set(sourceUrl, path);
        }
        const { storageKey: _privateKey, ...portable } = clip;
        clips.push({ ...portable, url: path });
    }

    const portable: CanvasComposition = { version: 1, clips };
    files.push({ name: "composition.json", data: JSON.stringify(portable, null, 2) });
    files.push({ name: "预览.html", data: offlinePlayer(portable) });
    files.push({ name: "使用说明.txt", data: "请先完整解压 ZIP，再用浏览器打开 预览.html。\nmedia 文件夹内是真实原始视频；composition.json 保存顺序、入点、出点与逐段音量。\n本包用于可携带的编排预览，并非合成渲染后的单个 MP4。\n浏览器必须支持原始视频的编码格式。" });
    return createZip(files);
}
