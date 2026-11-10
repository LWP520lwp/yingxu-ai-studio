import { useEffect, useRef, useState } from "react";
import { App, Button, InputNumber, Modal } from "antd";
import { ArrowDown, ArrowUp, Download, Film, Pause, Play, Scissors, SkipBack, SkipForward, Volume2 } from "lucide-react";

import { COMPOSITION_NODE_TYPE, clipDurationMs, exportCompositionPackage, formatCompositionTime, moveCompositionClip, normalizeClip, type CanvasComposition, type CompositionClip } from "@/lib/canvas/canvas-composition";
import { resolveMediaUrl } from "@/services/file-storage";
import type { CanvasNodeContext, CanvasNodeDefinition } from "@/types/canvas-plugin";
import "./composition-node.css";

function CompositionPlayer({ composition, onDuration, requestedClip }: { composition: CanvasComposition; onDuration?: (id: string, durationMs: number) => void; requestedClip?: { id: string; request: number } }) {
    const [index, setIndex] = useState(0);
    const [source, setSource] = useState<{ clipId: string; url: string } | null>(null);
    const [error, setError] = useState("");
    const [playing, setPlaying] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const videoRef = useRef<HTMLVideoElement>(null);
    const continuePlayback = useRef(false);
    const switching = useRef(false);
    const clip = composition.clips[index];
    const durationCallback = useRef(onDuration);
    durationCallback.current = onDuration;

    useEffect(() => {
        let cancelled = false;
        setSource(null); setError(""); setPlaying(false); setElapsed(0);
        switching.current = true;
        if (clip) void resolveMediaUrl(clip.storageKey, clip.url).then((url) => { if (!cancelled) setSource({ clipId: clip.id, url }); }, () => { if (!cancelled) setError("无法读取视频素材，请重新上传源视频"); });
        return () => { cancelled = true; };
    }, [clip?.id, clip?.url, clip?.storageKey]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !clip) return;
        video.volume = normalizeClip(clip).volume;
        if (video.readyState >= 1 && (video.currentTime * 1000 < clip.startMs || clip.endMs !== null && video.currentTime * 1000 > clip.endMs)) video.currentTime = clip.startMs / 1000;
    }, [clip?.volume, clip?.startMs, clip?.endMs]);

    useEffect(() => {
        if (!requestedClip) return;
        const next = composition.clips.findIndex((item) => item.id === requestedClip.id);
        if (next < 0) return;
        continuePlayback.current = true;
        if (next === index && videoRef.current && videoRef.current.readyState >= 1) {
            videoRef.current.currentTime = composition.clips[next].startMs / 1000;
            void videoRef.current.play().catch(() => setError("浏览器暂停了自动播放，请点击播放按钮"));
        } else setIndex(next);
    }, [requestedClip?.request]);

    const loadClip = (next: number, play: boolean) => {
        if (next < 0 || next >= composition.clips.length) return;
        continuePlayback.current = play;
        switching.current = true;
        setIndex(next);
    };
    const advance = () => {
        if (switching.current) return;
        switching.current = true;
        videoRef.current?.pause();
        if (index + 1 < composition.clips.length) loadClip(index + 1, true);
        else { switching.current = false; continuePlayback.current = false; setPlaying(false); }
    };
    const togglePlay = () => {
        const video = videoRef.current;
        if (!video || !clip) return;
        if (!video.paused) video.pause();
        else {
            const end = (clip.endMs ?? clip.durationMs ?? Infinity) / 1000;
            if (video.ended || video.currentTime >= end - 0.04) video.currentTime = clip.startMs / 1000;
            void video.play().catch(() => setError("无法播放，请确认视频编码可被浏览器支持"));
        }
    };
    return <div className="composition-player" data-canvas-no-zoom>
        <div className="composition-screen">
            {source && clip && source.clipId === clip.id ? <video key={`${clip.id}:${source.url}`} ref={videoRef} src={source.url} playsInline controls preload="metadata"
                onLoadedMetadata={(event) => {
                    const video = event.currentTarget;
                    switching.current = false;
                    video.volume = normalizeClip(clip).volume;
                    video.currentTime = clip.startMs / 1000;
                    if (Number.isFinite(video.duration) && video.duration > 0) durationCallback.current?.(clip.id, Math.round(video.duration * 1000));
                    if (continuePlayback.current) void video.play().catch(() => setError("点击播放继续预览"));
                }}
                onTimeUpdate={(event) => {
                    setElapsed(Math.max(0, event.currentTarget.currentTime * 1000 - clip.startMs));
                    if (clip.endMs !== null && event.currentTarget.currentTime * 1000 >= clip.endMs && !event.currentTarget.paused) advance();
                }}
                onSeeking={(event) => {
                    const video = event.currentTarget;
                    const end = clip.endMs ?? clip.durationMs;
                    if (video.currentTime * 1000 < clip.startMs - 10) video.currentTime = clip.startMs / 1000;
                    else if (end !== undefined && end !== null && video.currentTime * 1000 > end + 10) video.currentTime = end / 1000;
                }}
                onEnded={advance} onPlay={() => { setPlaying(true); setError(""); }} onPause={() => setPlaying(false)}
                onError={() => { switching.current = false; setError("视频无法播放：素材已失效或浏览器不支持其编码"); }} /> : <span className="composition-loading">正在读取素材…</span>}
            {error ? <div className="composition-error" role="alert">{error}</div> : null}
        </div>
        <div className="composition-playback">
            <button type="button" aria-label="上一段" disabled={index === 0} onClick={() => loadClip(index - 1, playing)}><SkipBack size={16}/></button>
            <button type="button" aria-label={playing ? "暂停合成预览" : "播放合成预览"} onClick={togglePlay}>{playing ? <Pause size={17}/> : <Play size={17}/>}</button>
            <button type="button" aria-label="下一段" disabled={index + 1 >= composition.clips.length} onClick={() => loadClip(index + 1, playing)}><SkipForward size={16}/></button>
            <span>{index + 1} / {composition.clips.length} · {formatCompositionTime(elapsed)} / {formatCompositionTime(clip ? clipDurationMs(clip) : 0)}</span>
            <span className="composition-playing-title" title={clip?.title}>{clip?.title}</span>
        </div>
    </div>;
}

function CompositionNode({ ctx }: { ctx: CanvasNodeContext }) {
    const { message } = App.useApp();
    const [open, setOpen] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [requestedClip, setRequestedClip] = useState<{ id: string; request: number }>();
    const composition = ctx.node.metadata?.composition;
    const compositionKey = JSON.stringify(composition);
    const latestCompositionKey = useRef(compositionKey);
    latestCompositionKey.current = compositionKey;
    type PreparedDownload = { key: string | undefined; url: string; name: string };
    const [preparedDownload, setPreparedDownload] = useState<PreparedDownload | null>(null);
    const preparedDownloadRef = useRef<PreparedDownload | null>(null);
    const exportController = useRef<AbortController | null>(null);
    useEffect(() => {
        setPreparedDownload(null);
        setExporting(false);
        return () => {
            exportController.current?.abort();
            exportController.current = null;
            if (preparedDownloadRef.current) URL.revokeObjectURL(preparedDownloadRef.current.url);
            preparedDownloadRef.current = null;
        };
    }, [compositionKey]);
    if (!composition?.clips.length) return <div className="composition-empty">请重新选择至少两个已有视频创建合成预览</div>;

    const update = (next: CanvasComposition) => ctx.updateMetadata({ composition: next });
    const updateClip = (id: string, patch: Partial<CompositionClip>) => update({ ...composition, clips: composition.clips.map((clip) => clip.id === id ? normalizeClip({ ...clip, ...patch }) : clip) });
    const recordDuration = (id: string, durationMs: number) => {
        if (composition.clips.find((clip) => clip.id === id)?.durationMs !== durationMs) updateClip(id, { durationMs });
    };
    const exportPackage = async () => {
        if (exportController.current && !exportController.current.signal.aborted) return;
        if (preparedDownloadRef.current) URL.revokeObjectURL(preparedDownloadRef.current.url);
        preparedDownloadRef.current = null;
        setPreparedDownload(null);
        const controller = new AbortController();
        exportController.current = controller;
        setExporting(true);
        try {
            const blob = await exportCompositionPackage(composition, controller.signal);
            if (!controller.signal.aborted && exportController.current === controller && latestCompositionKey.current === compositionKey) {
                const prepared = { key: compositionKey, url: URL.createObjectURL(blob), name: `${ctx.node.title.replace(/[\\/:*?"<>|]/g, "_") || "视频编排"}.zip` };
                preparedDownloadRef.current = prepared;
                setPreparedDownload(prepared);
            }
        } catch (error) {
            if (!controller.signal.aborted && exportController.current === controller && latestCompositionKey.current === compositionKey) void message.error(error instanceof Error ? error.message : "编排包导出失败");
        } finally {
            if (exportController.current === controller) {
                exportController.current = null;
                if (!controller.signal.aborted) setExporting(false);
            }
        }
    };
    const duration = composition.clips.reduce((sum, clip) => sum + clipDurationMs(clip), 0);
    const durationKnown = composition.clips.every((clip) => clip.durationMs || clip.endMs !== null);

    return <div className="composition-node" onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()} data-canvas-no-zoom>
        <div className="composition-header"><Film size={15}/><span>合成预览</span><span className="composition-summary">{composition.clips.length} 段 · {durationKnown ? formatCompositionTime(duration) : "待读取时长"}</span></div>
        {!open ? <CompositionPlayer composition={composition} onDuration={recordDuration}/> : <div className="composition-open-hint"><Film size={28}/><span>正在编辑编排</span></div>}
        <div className="composition-node-footer"><span>按编排顺序播放</span><button type="button" onClick={() => setOpen(true)}><Scissors size={14}/> 编辑编排</button></div>
        <Modal title={<span className="composition-modal-title"><Film size={18}/> 视频合成预览 <small>顺序 · 选段 · 音量</small></span>} open={open} onCancel={() => setOpen(false)} footer={null} width={1080} centered destroyOnHidden>
            {open ? <div className="composition-editor" onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                <div className="composition-editor-preview"><CompositionPlayer key={composition.clips.map((clip) => clip.id).join(":")} composition={composition} requestedClip={requestedClip} onDuration={recordDuration}/>
                    <p className="composition-export-note">修改会随画布自动保存。导出 ZIP 包含素材、编排和离线播放器；当前不生成单个 MP4。</p>
                    <div className="composition-download-actions">
                        <Button icon={<Download size={15}/>} loading={exporting} onClick={() => void exportPackage()}>导出编排包 ZIP</Button>
                        {preparedDownload?.key === compositionKey ? <a className="composition-download-link" href={preparedDownload.url} download={preparedDownload.name}><Download size={15}/> 下载编排包 ZIP</a> : null}
                    </div>
                </div>
                <div className="composition-clip-list" aria-label="视频编排顺序">
                    {composition.clips.map((clip, index) => <section key={clip.id} className="composition-clip-card">
                        <div className="composition-clip-heading"><span className="composition-clip-number">{index + 1}</span><strong title={clip.title}>{clip.title}</strong>
                            <button type="button" aria-label={`播放第 ${index + 1} 段`} onClick={() => setRequestedClip({ id: clip.id, request: Date.now() })}><Play size={14}/></button>
                            <button type="button" aria-label={`上移第 ${index + 1} 段`} disabled={index === 0} onClick={() => update(moveCompositionClip(composition, index, -1))}><ArrowUp size={15}/></button>
                            <button type="button" aria-label={`下移第 ${index + 1} 段`} disabled={index + 1 === composition.clips.length} onClick={() => update(moveCompositionClip(composition, index, 1))}><ArrowDown size={15}/></button>
                        </div>
                        <div className="composition-clip-range"><label>入点（秒）<InputNumber aria-label={`第 ${index + 1} 段入点秒数`} min={0} max={clip.durationMs ? Math.max(0, clip.durationMs / 1000 - .1) : undefined} step={.1} precision={2} value={clip.startMs / 1000} onChange={(value) => { if (value !== null) updateClip(clip.id, { startMs: value * 1000 }); }}/></label>
                            <label>出点（秒）<InputNumber aria-label={`第 ${index + 1} 段出点秒数`} min={(clip.startMs + 100) / 1000} max={clip.durationMs ? clip.durationMs / 1000 : undefined} step={.1} precision={2} value={clip.endMs === null ? null : clip.endMs / 1000} placeholder={clip.durationMs ? `${(clip.durationMs / 1000).toFixed(2)}（结尾）` : "原片结尾"} onChange={(value) => updateClip(clip.id, { endMs: value === null ? null : value * 1000 })}/></label></div>
                        <label className="composition-volume"><Volume2 size={14}/><span>片段音量</span><input aria-label={`第 ${index + 1} 段音量`} type="range" min="0" max="100" value={Math.round(clip.volume * 100)} onChange={(event) => updateClip(clip.id, { volume: Number(event.target.value) / 100 })}/><output>{Math.round(clip.volume * 100)}%</output></label>
                        <div className="composition-clip-duration">选段时长 {clip.durationMs || clip.endMs !== null ? formatCompositionTime(clipDurationMs(clip)) : "播放该片段后读取"}</div>
                    </section>)}
                </div>
            </div> : null}
        </Modal>
    </div>;
}

export const COMPOSITION_NODE_DEFINITION: CanvasNodeDefinition = {
    type: COMPOSITION_NODE_TYPE, title: "视频合成预览", icon: <Film className="size-4"/>,
    defaultSize: { width: 480, height: 340 }, defaultMetadata: { status: "success" },
    minimapColor: "#8477ca", showInCreateMenu: false, hidePanel: true, Content: CompositionNode,
};
