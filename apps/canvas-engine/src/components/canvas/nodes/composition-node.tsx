import { useEffect, useRef, useState } from "react";
import { App, Button, InputNumber, Modal, Select } from "antd";
import {
  ArrowDown,
  ArrowUp,
  Clock3,
  Download,
  Film,
  Pause,
  Play,
  Scissors,
  SkipBack,
  SkipForward,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";

import {
  COMPOSITION_NODE_TYPE,
  clipDurationMs,
  compositionVideos,
  createComposition,
  exportCompositionPackage,
  formatCompositionTime,
  moveCompositionClip,
  normalizeClip,
  type CanvasComposition,
  type CompositionClip,
} from "@/lib/canvas/canvas-composition";
import { resolveMediaUrl } from "@/services/file-storage";
import type { CanvasNodeData } from "@/types/canvas";
import type {
  CanvasNodeContext,
  CanvasNodeDefinition,
} from "@/types/canvas-plugin";
import "./composition-node.css";

type RequestedClip = { id: string; request: number };
type PreparedDownload = { key: string; url: string; name: string };

function CompositionPlayer({
  composition,
  onDuration,
  requestedClip,
}: {
  composition: CanvasComposition;
  onDuration?: (id: string, durationMs: number) => void;
  requestedClip?: RequestedClip;
}) {
  const [index, setIndex] = useState(0);
  const [source, setSource] = useState<{ clipId: string; url: string } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const continuePlayback = useRef(false);
  const switching = useRef(false);
  const clip = composition.clips[index];
  const durationCallback = useRef(onDuration);
  durationCallback.current = onDuration;
  const selectedDuration = clip ? clipDurationMs(clip) : 0;

  useEffect(() => {
    let cancelled = false;
    setSource(null);
    setError("");
    setPlaying(false);
    setMuted(false);
    setElapsed(0);
    switching.current = true;
    if (clip) {
      void resolveMediaUrl(clip.storageKey, clip.url).then(
        (url) => {
          if (!cancelled) setSource({ clipId: clip.id, url });
        },
        () => {
          if (!cancelled) setError("无法读取视频素材，请重新上传源视频");
        },
      );
    }
    return () => {
      cancelled = true;
    };
  }, [clip?.id, clip?.url, clip?.storageKey]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !clip) return;
    video.volume = normalizeClip(clip).volume;
    video.muted = muted;
    const currentMs = video.currentTime * 1000;
    if (
      video.readyState >= 1 &&
      (currentMs < clip.startMs ||
        (clip.endMs !== null && currentMs > clip.endMs))
    ) {
      video.currentTime = clip.startMs / 1000;
    }
  }, [clip?.volume, clip?.startMs, clip?.endMs, muted]);

  useEffect(() => {
    if (!requestedClip) return;
    const next = composition.clips.findIndex(
      (item) => item.id === requestedClip.id,
    );
    if (next < 0) return;
    continuePlayback.current = true;
    if (
      next === index &&
      videoRef.current &&
      videoRef.current.readyState >= 1
    ) {
      videoRef.current.currentTime = composition.clips[next].startMs / 1000;
      void videoRef.current
        .play()
        .catch(() => setError("浏览器暂停了自动播放，请点击播放按钮"));
    } else {
      setIndex(next);
    }
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
    if (index + 1 < composition.clips.length) {
      loadClip(index + 1, true);
    } else {
      switching.current = false;
      continuePlayback.current = false;
      setPlaying(false);
    }
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video || !clip) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    const end = (clip.endMs ?? clip.durationMs ?? Infinity) / 1000;
    if (video.ended || video.currentTime >= end - 0.04)
      video.currentTime = clip.startMs / 1000;
    void video
      .play()
      .catch(() => setError("无法播放，请确认视频编码可被浏览器支持"));
  };

  const seek = (value: number) => {
    if (!clip || !videoRef.current || !Number.isFinite(value)) return;
    const position = Math.min(selectedDuration, Math.max(0, value));
    videoRef.current.currentTime = (clip.startMs + position) / 1000;
    setElapsed(position);
  };

  if (!clip) {
    return (
      <div className="composition-player composition-player-empty">
        没有可播放的视频片段
      </div>
    );
  }

  return (
    <section
      className="composition-player"
      data-canvas-no-zoom
      aria-label="视频预览"
    >
      <div className="composition-screen">
        {source?.clipId === clip.id ? (
          <video
            key={`${clip.id}:${source.url}`}
            ref={videoRef}
            src={source.url}
            playsInline
            controls
            preload="metadata"
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              switching.current = false;
              video.volume = normalizeClip(clip).volume;
              video.muted = muted;
              const sourceEnd = Number.isFinite(video.duration)
                ? Math.round(video.duration * 1000)
                : undefined;
              const durationMs = clip.durationMs || sourceEnd;
              video.currentTime = Math.min(
                clip.startMs / 1000,
                Math.max(0, video.duration - 0.05),
              );
              if (sourceEnd && sourceEnd > 0)
                durationCallback.current?.(clip.id, sourceEnd);
              if (continuePlayback.current)
                void video.play().catch(() => setError("点击播放继续预览"));
              setElapsed(0);
              if (durationMs && !selectedDuration) setElapsed(0);
            }}
            onTimeUpdate={(event) => {
              const video = event.currentTarget;
              const position = Math.max(
                0,
                video.currentTime * 1000 - clip.startMs,
              );
              setElapsed(Math.min(selectedDuration || position, position));
              if (
                clip.endMs !== null &&
                video.currentTime * 1000 >= clip.endMs &&
                !video.paused
              ) {
                advance();
              }
            }}
            onSeeking={(event) => {
              const video = event.currentTarget;
              const end = clip.endMs ?? clip.durationMs;
              if (video.currentTime * 1000 < clip.startMs - 10) {
                video.currentTime = clip.startMs / 1000;
              } else if (
                end !== undefined &&
                end !== null &&
                video.currentTime * 1000 > end + 10
              ) {
                video.currentTime = end / 1000;
              }
            }}
            onEnded={advance}
            onPlay={() => {
              setPlaying(true);
              setError("");
            }}
            onPause={() => setPlaying(false)}
            onError={() => {
              switching.current = false;
              setError("视频无法播放：素材已失效或浏览器不支持其编码");
            }}
          />
        ) : (
          <span className="composition-loading" role="status">
            正在读取素材…
          </span>
        )}
        {error ? (
          <div className="composition-error" role="alert">
            {error}
          </div>
        ) : null}
      </div>

      <div className="composition-transport">
        <div className="composition-transport-buttons">
          <button
            type="button"
            aria-label="上一段"
            title="上一段"
            disabled={index === 0}
            onClick={() => loadClip(index - 1, playing)}
          >
            <SkipBack aria-hidden="true" />
          </button>
          <button
            type="button"
            className="composition-primary-control"
            aria-label={playing ? "暂停合成预览" : "播放合成预览"}
            title={playing ? "暂停" : "播放"}
            onClick={togglePlay}
          >
            {playing ? (
              <Pause aria-hidden="true" />
            ) : (
              <Play aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            aria-label="下一段"
            title="下一段"
            disabled={index + 1 >= composition.clips.length}
            onClick={() => loadClip(index + 1, playing)}
          >
            <SkipForward aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={muted ? "取消静音" : "静音"}
            title={muted ? "取消静音" : "静音"}
            aria-pressed={muted}
            onClick={() => setMuted((value) => !value)}
          >
            {muted ? (
              <VolumeX aria-hidden="true" />
            ) : (
              <Volume2 aria-hidden="true" />
            )}
          </button>
        </div>
        <label className="composition-seek-control">
          <span className="composition-seek-time">
            {formatCompositionTime(elapsed)}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(1, selectedDuration)}
            step={100}
            value={Math.min(elapsed, selectedDuration)}
            aria-label="播放位置"
            onChange={(event) => seek(Number(event.target.value))}
          />
          <span className="composition-seek-time">
            {formatCompositionTime(selectedDuration)}
          </span>
        </label>
        <div className="composition-playing-title" title={clip.title}>
          <span className="composition-clip-position">
            {index + 1} / {composition.clips.length}
          </span>
          <span>{clip.title}</span>
        </div>
      </div>
    </section>
  );
}

function TrimControls({
  clip,
  index,
  onChange,
}: {
  clip: CompositionClip;
  index: number;
  onChange: (patch: Partial<CompositionClip>) => void;
}) {
  const sourceDuration = clip.durationMs;
  const outMs = clip.endMs ?? sourceDuration;
  const hasRange = Boolean(sourceDuration && sourceDuration > 0 && outMs);

  return (
    <div className="composition-trim">
      {hasRange && sourceDuration ? (
        <div
          className="composition-trim-track"
          style={
            {
              "--trim-start": `${(clip.startMs / sourceDuration) * 100}%`,
              "--trim-end": `${((outMs || sourceDuration) / sourceDuration) * 100}%`,
            } as React.CSSProperties
          }
          aria-hidden="true"
        >
          <span />
        </div>
      ) : (
        <div className="composition-trim-unavailable">
          <Clock3 aria-hidden="true" />
          <span>播放片段以读取原片时长并启用裁切滑块</span>
        </div>
      )}

      {hasRange && sourceDuration ? (
        <div className="composition-trim-handles">
          <label>
            入点
            <input
              type="range"
              min={0}
              max={Math.max(0, sourceDuration - 100)}
              step={100}
              value={clip.startMs}
              aria-label={`第 ${index + 1} 段入点`}
              onChange={(event) =>
                onChange({ startMs: Number(event.target.value) })
              }
            />
            <output>{formatCompositionTime(clip.startMs)}</output>
          </label>
          <label>
            出点
            <input
              type="range"
              min={Math.min(sourceDuration, clip.startMs + 100)}
              max={sourceDuration}
              step={100}
              value={outMs || sourceDuration}
              aria-label={`第 ${index + 1} 段出点`}
              onChange={(event) => {
                const value = Number(event.target.value);
                onChange({ endMs: value >= sourceDuration ? null : value });
              }}
            />
            <output>{formatCompositionTime(outMs || sourceDuration)}</output>
          </label>
        </div>
      ) : null}

      <div className="composition-trim-inputs">
        <label>
          <span>入点（秒）</span>
          <InputNumber
            aria-label={`第 ${index + 1} 段入点秒数`}
            min={0}
            max={
              clip.durationMs
                ? Math.max(0, clip.durationMs / 1000 - 0.1)
                : undefined
            }
            step={0.1}
            precision={2}
            value={clip.startMs / 1000}
            onChange={(value) => {
              if (value !== null) onChange({ startMs: value * 1000 });
            }}
          />
        </label>
        <label>
          <span>出点（秒）</span>
          <InputNumber
            aria-label={`第 ${index + 1} 段出点秒数`}
            min={(clip.startMs + 100) / 1000}
            max={clip.durationMs ? clip.durationMs / 1000 : undefined}
            step={0.1}
            precision={2}
            value={clip.endMs === null ? null : clip.endMs / 1000}
            placeholder={
              clip.durationMs
                ? `${(clip.durationMs / 1000).toFixed(2)}（结尾）`
                : "原片结尾"
            }
            onChange={(value) =>
              onChange({ endMs: value === null ? null : value * 1000 })
            }
          />
        </label>
      </div>
    </div>
  );
}

function CompositionNode({ ctx }: { ctx: CanvasNodeContext }) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [requestedClip, setRequestedClip] = useState<RequestedClip>();
  const requestSequence = useRef(0);
  const composition: CanvasComposition = ctx.node.metadata?.composition ?? {
    version: 1,
    clips: [],
  };
  const compositionKey = JSON.stringify(composition);
  const latestCompositionKey = useRef(compositionKey);
  latestCompositionKey.current = compositionKey;
  const [preparedDownload, setPreparedDownload] =
    useState<PreparedDownload | null>(null);
  const preparedDownloadRef = useRef<PreparedDownload | null>(null);
  const exportController = useRef<AbortController | null>(null);

  useEffect(() => {
    setPreparedDownload(null);
    setExporting(false);
    return () => {
      exportController.current?.abort();
      exportController.current = null;
      if (preparedDownloadRef.current)
        URL.revokeObjectURL(preparedDownloadRef.current.url);
      preparedDownloadRef.current = null;
    };
  }, [compositionKey]);

  const update = (next: CanvasComposition) =>
    ctx.updateMetadata({ composition: next });
  const updateClip = (id: string, patch: Partial<CompositionClip>) =>
    update({
      ...composition,
      clips: composition.clips.map((clip) =>
        clip.id === id ? normalizeClip({ ...clip, ...patch }) : clip,
      ),
    });
  const recordDuration = (id: string, durationMs: number) => {
    const clip = composition.clips.find((item) => item.id === id);
    if (clip && clip.durationMs !== durationMs) updateClip(id, { durationMs });
  };

  const sourceVideos = compositionVideos(ctx.getNodes());
  const usedSourceIds = new Set(
    composition.clips.map((clip) => clip.sourceNodeId),
  );
  const addableVideos = sourceVideos.filter(
    (node) => !usedSourceIds.has(node.id),
  );

  const addVideo = (sourceId: string) => {
    const node = addableVideos.find((item) => item.id === sourceId);
    if (!node) return;
    const [clip] = createComposition([node]).clips;
    if (!clip) return;
    update({ ...composition, clips: [...composition.clips, clip] });
    setRequestedClip({ id: clip.id, request: ++requestSequence.current });
  };

  const removeClip = (clipId: string) => {
    update({
      ...composition,
      clips: composition.clips.filter((clip) => clip.id !== clipId),
    });
  };

  const requestPlayback = (clipId: string) => {
    setRequestedClip({ id: clipId, request: ++requestSequence.current });
  };

  const cancelExport = () => {
    exportController.current?.abort();
    setExporting(false);
  };

  const exportPackage = async () => {
    if (exportController.current && !exportController.current.signal.aborted)
      return;
    if (preparedDownloadRef.current)
      URL.revokeObjectURL(preparedDownloadRef.current.url);
    preparedDownloadRef.current = null;
    setPreparedDownload(null);
    const controller = new AbortController();
    exportController.current = controller;
    setExporting(true);
    try {
      const blob = await exportCompositionPackage(
        composition,
        controller.signal,
      );
      if (
        !controller.signal.aborted &&
        exportController.current === controller &&
        latestCompositionKey.current === compositionKey
      ) {
        const safeTitle =
          ctx.node.title.replace(/[\\/:*?"<>|]/g, "_").trim() || "视频编排";
        const prepared = {
          key: compositionKey,
          url: URL.createObjectURL(blob),
          name: `${safeTitle}.zip`,
        };
        preparedDownloadRef.current = prepared;
        setPreparedDownload(prepared);
      }
    } catch (error) {
      if (
        !controller.signal.aborted &&
        exportController.current === controller &&
        latestCompositionKey.current === compositionKey
      ) {
        void message.error(
          error instanceof Error ? error.message : "编排包导出失败",
        );
      }
    } finally {
      if (exportController.current === controller) {
        exportController.current = null;
        setExporting(false);
      }
    }
  };

  const duration = composition.clips.reduce(
    (sum, clip) => sum + clipDurationMs(clip),
    0,
  );
  const durationKnown = composition.clips.every(
    (clip) => Boolean(clip.durationMs) || clip.endMs !== null,
  );

  return (
    <div
      className="composition-node"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      data-canvas-no-zoom
    >
      <header className="composition-header">
        <Film aria-hidden="true" />
        <span>视频编排</span>
        <span className="composition-summary" aria-live="polite">
          {composition.clips.length} 段<span aria-hidden="true"> · </span>
          {durationKnown ? formatCompositionTime(duration) : "时长待读取"}
        </span>
      </header>

      {composition.clips.length ? (
        <CompositionPlayer
          composition={composition}
          onDuration={recordDuration}
        />
      ) : (
        <div className="composition-empty">
          <Film aria-hidden="true" />
          <strong>添加视频片段开始编排</strong>
          <span>可从当前画布中选择已有视频</span>
          <AddVideoControl videos={addableVideos} onAdd={addVideo} />
        </div>
      )}

      <footer className="composition-node-footer">
        <span>更改会随画布自动保存</span>
        <button type="button" onClick={() => setOpen(true)}>
          <Scissors aria-hidden="true" />
          编辑编排
        </button>
      </footer>

      <Modal
        title={
          <div className="composition-modal-title">
            <Film aria-hidden="true" />
            <span>视频编排</span>
            <small>顺序 · 裁切 · 音量</small>
          </div>
        }
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width="min(1180px, calc(100vw - 32px))"
        centered
        destroyOnHidden
        styles={{ body: { padding: "8px 20px 20px" } }}
      >
        <div
          className="composition-editor"
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <section className="composition-editor-stage" aria-label="预览和导出">
            {composition.clips.length ? (
              <CompositionPlayer
                key={composition.clips.map((clip) => clip.id).join(":")}
                composition={composition}
                requestedClip={requestedClip}
                onDuration={recordDuration}
              />
            ) : (
              <div className="composition-editor-empty">
                添加视频后可在这里预览编排结果。
              </div>
            )}

            <div className="composition-export-panel">
              <div>
                <strong>导出可携带的编排包</strong>
                <p>
                  ZIP 包含源视频、裁切设置、顺序和离线预览；不会渲染为单个 MP4。
                </p>
              </div>
              <div className="composition-download-actions">
                <Button
                  icon={<Download aria-hidden="true" />}
                  loading={exporting}
                  disabled={!composition.clips.length}
                  onClick={() => void exportPackage()}
                >
                  生成 ZIP
                </Button>
                {exporting ? (
                  <Button onClick={cancelExport}>取消导出</Button>
                ) : null}
                {preparedDownload?.key === compositionKey ? (
                  <a
                    className="composition-download-link"
                    href={preparedDownload.url}
                    download={preparedDownload.name}
                  >
                    <Download aria-hidden="true" />
                    下载 ZIP
                  </a>
                ) : null}
              </div>
            </div>
          </section>

          <section className="composition-timeline" aria-label="视频片段列表">
            <div className="composition-timeline-heading">
              <div>
                <h2>片段顺序</h2>
                <span>{composition.clips.length} 个源视频</span>
              </div>
              <AddVideoControl videos={addableVideos} onAdd={addVideo} />
            </div>

            {composition.clips.length ? (
              <div className="composition-clip-list" role="list">
                {composition.clips.map((clip, index) => (
                  <article
                    key={clip.id}
                    className="composition-clip-card"
                    role="listitem"
                  >
                    <header className="composition-clip-heading">
                      <span
                        className="composition-clip-number"
                        aria-hidden="true"
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <strong title={clip.title}>{clip.title}</strong>
                      <div className="composition-clip-actions">
                        <IconAction
                          label={`预览第 ${index + 1} 段`}
                          onClick={() => requestPlayback(clip.id)}
                        >
                          <Play aria-hidden="true" />
                        </IconAction>
                        <IconAction
                          label={`上移第 ${index + 1} 段`}
                          disabled={index === 0}
                          onClick={() =>
                            update(moveCompositionClip(composition, index, -1))
                          }
                        >
                          <ArrowUp aria-hidden="true" />
                        </IconAction>
                        <IconAction
                          label={`下移第 ${index + 1} 段`}
                          disabled={index + 1 === composition.clips.length}
                          onClick={() =>
                            update(moveCompositionClip(composition, index, 1))
                          }
                        >
                          <ArrowDown aria-hidden="true" />
                        </IconAction>
                        <IconAction
                          label={`移除第 ${index + 1} 段`}
                          danger
                          onClick={() => removeClip(clip.id)}
                        >
                          <Trash2 aria-hidden="true" />
                        </IconAction>
                      </div>
                    </header>

                    <TrimControls
                      clip={clip}
                      index={index}
                      onChange={(patch) => updateClip(clip.id, patch)}
                    />

                    <label className="composition-volume">
                      <span className="composition-volume-label">
                        <Volume2 aria-hidden="true" />
                        片段音量
                      </span>
                      <input
                        aria-label={`第 ${index + 1} 段音量`}
                        type="range"
                        min="0"
                        max="100"
                        value={Math.round(clip.volume * 100)}
                        onChange={(event) =>
                          updateClip(clip.id, {
                            volume: Number(event.target.value) / 100,
                          })
                        }
                      />
                      <output>{Math.round(clip.volume * 100)}%</output>
                    </label>
                    <div className="composition-clip-duration">
                      选段时长
                      <strong>
                        {clip.durationMs || clip.endMs !== null
                          ? formatCompositionTime(clipDurationMs(clip))
                          : "播放该片段后读取"}
                      </strong>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="composition-list-empty">
                <span>当前编排为空</span>
                <AddVideoControl videos={addableVideos} onAdd={addVideo} />
              </div>
            )}
          </section>
        </div>
      </Modal>
    </div>
  );
}

function AddVideoControl({
  videos,
  onAdd,
}: {
  videos: CanvasNodeData[];
  onAdd: (sourceId: string) => void;
}) {
  return (
    <div className="composition-add-video">
      <Select
        aria-label="添加画布视频"
        className="composition-add-select"
        placeholder={videos.length ? "添加视频" : "没有可添加的视频"}
        value={undefined}
        disabled={!videos.length}
        options={videos.map((node) => ({
          value: node.id,
          label: node.title || "未命名视频",
        }))}
        onChange={(sourceId: string) => onAdd(sourceId)}
        optionFilterProp="label"
        showSearch
      />
      <PlusLabel />
    </div>
  );
}

function PlusLabel() {
  return (
    <span className="composition-add-icon" aria-hidden="true">
      <Film />
    </span>
  );
}

function IconAction({
  label,
  children,
  onClick,
  disabled = false,
  danger = false,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={
        danger ? "composition-icon-action is-danger" : "composition-icon-action"
      }
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export const COMPOSITION_NODE_DEFINITION: CanvasNodeDefinition = {
  type: COMPOSITION_NODE_TYPE,
  title: "视频合成预览",
  icon: <Film className="size-4" />,
  defaultSize: { width: 480, height: 340 },
  defaultMetadata: { status: "success" },
  minimapColor: "#8477ca",
  showInCreateMenu: false,
  hidePanel: true,
  Content: CompositionNode,
};
