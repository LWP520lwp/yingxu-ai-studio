import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Download,
  Film,
  Link2,
  Play,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  CanvasConnection,
  CanvasNodeData,
  CanvasNodeMetadata,
} from "@/types/canvas";
import { resolveMediaUrl } from "@/services/file-storage";
import { createZip, type ZipFile } from "@/lib/zip";
import "./studio-sequence.css";

type Sequence = NonNullable<CanvasNodeMetadata["composition"]>;
export type StudioSequenceClip = Sequence["clips"][number];
type Props = {
  node: CanvasNodeData;
  onMetadata(patch: CanvasNodeMetadata): void;
  nodes: CanvasNodeData[];
  connections: CanvasConnection[];
};
const number = (value: number | undefined, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

export function boundStudioSegment(
  clip: StudioSequenceClip,
): StudioSequenceClip {
  const durationMs =
    number(clip.durationMs, 0) > 0 ? clip.durationMs : undefined;
  const minimum = Math.min(1, durationMs || 1);
  const startMs = Math.max(
    0,
    Math.min(
      number(clip.startMs, 0),
      durationMs ? Math.max(0, durationMs - minimum) : Infinity,
    ),
  );
  const endMs =
    clip.endMs === null || !Number.isFinite(clip.endMs)
      ? null
      : Math.max(
          startMs + minimum,
          Math.min(clip.endMs, durationMs || Infinity),
        );
  return {
    ...clip,
    startMs,
    endMs,
    durationMs,
    volume: Math.min(1, Math.max(0, number(clip.volume, 1))),
  };
}

export function studioSequenceLength(clips: readonly StudioSequenceClip[]): {
  milliseconds: number;
  unknown: boolean;
} {
  return clips.reduce<{ milliseconds: number; unknown: boolean }>(
    (total, item) => {
      const clip = boundStudioSegment(item),
        end = clip.endMs ?? clip.durationMs;
      return {
        milliseconds:
          total.milliseconds + (end === undefined ? 0 : end - clip.startMs),
        unknown: total.unknown || end === undefined,
      };
    },
    { milliseconds: 0, unknown: false },
  );
}

export function rearrangeStudioSegments(
  clips: readonly StudioSequenceClip[],
  id: string,
  direction: -1 | 1,
): StudioSequenceClip[] | null {
  const index = clips.findIndex((clip) => clip.id === id),
    destination = index + direction;
  if (index < 0 || destination < 0 || destination >= clips.length) return null;
  const reordered = [...clips];
  reordered.splice(destination, 0, reordered.splice(index, 1)[0]);
  return reordered;
}

const timestamp = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 100));
  return `${Math.floor(seconds / 600)}:${((seconds % 600) / 10).toFixed(1).padStart(4, "0")}`;
};

/** Embedded player uses only the portable manifest and DOM text, never source HTML. */
function portableSequencePlayer() {
  const data = JSON.parse(
    document.getElementById("sequence-data")!.textContent!,
  ) as { clips: StudioSequenceClip[] };
  const video = document.querySelector("video")!,
    label = document.querySelector("output")!;
  let index = 0,
    advance = false;
  const load = (next: number, play: boolean) => {
    index = next;
    advance = play;
    const clip = data.clips[index];
    if (!clip) return;
    video.src = clip.url;
    video.volume = clip.volume;
    label.textContent = `${index + 1}/${data.clips.length} · ${clip.title}`;
  };
  const next = () => {
    if (index + 1 < data.clips.length) load(index + 1, true);
    else {
      video.pause();
      label.textContent += " · End / 播放结束";
    }
  };
  video.onloadedmetadata = () => {
    const clip = data.clips[index];
    video.currentTime = Math.min(
      clip.startMs / 1000,
      Math.max(0, video.duration - 0.001),
    );
    if (advance)
      void video.play().catch(() => {
        label.textContent += " · Press play / 请点击播放";
      });
  };
  video.ontimeupdate = () => {
    const clip = data.clips[index];
    if (
      !video.paused &&
      clip.endMs !== null &&
      video.currentTime * 1000 >= clip.endMs
    ) {
      video.pause();
      next();
    }
  };
  video.onended = next;
  video.onerror = () => {
    label.textContent += " · Media unavailable / 素材不可用";
  };
  document.querySelector("button")!.onclick = () => load(0, true);
  load(0, false);
}

export async function packageStudioSequence(
  clips: readonly StudioSequenceClip[],
  signal: AbortSignal,
  progress?: (done: number, total: number) => void,
): Promise<Blob> {
  if (!clips.length) throw new Error("没有视频片段 / No video segments");
  const files: ZipFile[] = [],
    portable: StudioSequenceClip[] = [];
  const sources = new Map<string, string>();
  let bytes = 0;
  for (let index = 0; index < clips.length; index++) {
    signal.throwIfAborted();
    const clip = boundStudioSegment(clips[index]);
    const url = await resolveMediaUrl(clip.storageKey, clip.url);
    signal.throwIfAborted();
    let local = sources.get(url);
    if (!local) {
      const timeout = AbortSignal.timeout(90_000);
      const response = await fetch(url, {
        signal: AbortSignal.any([signal, timeout]),
      });
      if (!response.ok)
        throw new Error(
          `无法下载片段 / Segment unavailable: ${clip.title} (${response.status})`,
        );
      const declaredBytes = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(declaredBytes) &&
        bytes + declaredBytes > 512 * 1024 * 1024
      ) {
        await response.body?.cancel();
        throw new Error(
          "素材总量超过 512 MiB，请拆分编排后分别导出 / Split sequences larger than 512 MiB before exporting",
        );
      }
      const blob = await response.blob();
      signal.throwIfAborted();
      const mime = blob.type.split(";")[0].toLowerCase();
      if (
        !blob.size ||
        (mime &&
          !mime.startsWith("video/") &&
          mime !== "application/octet-stream")
      )
        throw new Error(`片段不是有效视频 / Invalid video: ${clip.title}`);
      bytes += blob.size;
      if (bytes > 512 * 1024 * 1024)
        throw new Error(
          "素材总量超过 512 MiB，请拆分编排后分别导出 / Split sequences larger than 512 MiB before exporting",
        );
      const kind = mime || clip.mimeType || "video/mp4";
      const extension = kind.includes("webm")
        ? "webm"
        : kind.includes("quicktime")
          ? "mov"
          : kind.includes("ogg")
            ? "ogv"
            : "mp4";
      local = `media/${String(sources.size + 1).padStart(3, "0")}.${extension}`;
      files.push({ name: local, data: blob });
      sources.set(url, local);
    }
    const { storageKey: _storage, ...publicClip } = clip;
    portable.push({ ...publicClip, url: local });
    progress?.(index + 1, clips.length);
  }
  const manifest = { version: 1, clips: portable };
  const json = JSON.stringify(manifest).replace(
    /[<>&\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>映序 · Sequence</title><style>body{margin:0;padding:32px;background:#111b25;color:#dbe8ee;font:15px system-ui}main{max-width:1000px;margin:auto}video{display:block;width:100%;max-height:75vh;background:#060a0e}button{margin:18px 12px 18px 0;padding:10px 18px;border:1px solid #527478;background:#1d3439;color:#e7fbf2;cursor:pointer}output{line-height:1.8}</style><main><h1>映序 · Sequence</h1><video controls playsinline></video><button>从头串播 / Play sequence</button><output></output><p>按选段顺序预览，素材保持原始编码。/ Sequential preview using original media files.</p></main><script type="application/json" id="sequence-data">${json}</script><script>(${portableSequencePlayer.toString()})();</script></html>`;
  files.push(
    { name: "sequence.json", data: JSON.stringify(manifest, null, 2) },
    { name: "index.html", data: html },
    {
      name: "README.txt",
      data: "完整解压后打开 index.html 串播。sequence.json 保存片段顺序、毫秒入出点和音量。media 中为真实源视频。此包保留剪辑编排，并非已渲染的单个 MP4。\nExtract all files and open index.html. sequence.json stores order, trims in milliseconds, and volume. media contains original videos. This package preserves the edit and is not a single rendered MP4.",
    },
  );
  signal.throwIfAborted();
  return createZip(files);
}

export function StudioSequence({
  node,
  onMetadata,
  nodes,
  connections,
}: Props) {
  const { i18n } = useTranslation();
  const zh = !i18n.resolvedLanguage?.startsWith("en");
  const say = (cn: string, en: string) => (zh ? cn : en);
  const clips = useMemo(
    () => (node.metadata?.composition?.clips || []).map(boundStudioSegment),
    [node.metadata?.composition],
  );
  const [selectedId, select] = useState(clips[0]?.id || ""),
    [playing, setPlaying] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({}),
    [error, setError] = useState("");
  const [exporting, setExporting] = useState(false),
    [progress, setProgress] = useState("");
  const player = useRef<HTMLVideoElement | null>(null),
    autoplay = useRef(false),
    advancing = useRef(false);
  const exportController = useRef<AbortController | null>(null),
    active = useRef(true);
  const index = Math.max(
    0,
    clips.findIndex((clip) => clip.id === selectedId),
  );
  const clip = clips[index];
  const length = studioSequenceLength(clips);
  const linked = new Set(
    connections
      .filter((edge) => edge.toNodeId === node.id)
      .map((edge) => edge.fromNodeId),
  );
  const available = nodes
    .filter((item) => item.type === "video" && item.metadata?.content)
    .sort((a, b) => Number(linked.has(b.id)) - Number(linked.has(a.id)));
  const signature = JSON.stringify(
    clips.map((item) => [item.id, item.url, item.storageKey]),
  );

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      exportController.current?.abort();
    };
  }, []);
  useEffect(() => {
    let current = true;
    void Promise.all(
      clips.map(
        async (item) =>
          [item.id, await resolveMediaUrl(item.storageKey, item.url)] as const,
      ),
    )
      .then((items) => {
        if (current) setUrls(Object.fromEntries(items));
      })
      .catch((reason) => {
        if (current)
          setError(
            reason instanceof Error
              ? reason.message
              : "素材读取失败 / Media unavailable",
          );
      });
    return () => {
      current = false;
    };
    // The signature follows media identity; trim and volume edits do not reopen local files.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  useEffect(() => {
    if (player.current && clip) player.current.volume = clip.volume;
  }, [clip?.volume]);
  useEffect(() => {
    if (player.current && clip && Number.isFinite(player.current.duration))
      player.current.currentTime = Math.min(
        clip.startMs / 1000,
        Math.max(0, player.current.duration - 0.001),
      );
  }, [clip?.id, clip?.startMs]);

  const save = (next: StudioSequenceClip[]) => {
    setError("");
    onMetadata({ composition: { version: 1, clips: next } });
  };
  const patch = (id: string, change: Partial<StudioSequenceClip>) =>
    save(
      clips.map((item) =>
        item.id === id ? boundStudioSegment({ ...item, ...change }) : item,
      ),
    );
  const choose = (id: string) => {
    autoplay.current = false;
    advancing.current = false;
    setPlaying(false);
    player.current?.pause();
    select(id);
    setError("");
  };
  const next = () => {
    if (advancing.current) return;
    advancing.current = true;
    player.current?.pause();
    if (index + 1 < clips.length) {
      autoplay.current = true;
      select(clips[index + 1].id);
    } else {
      autoplay.current = false;
      setPlaying(false);
    }
  };
  const begin = () => {
    if (!clip) return;
    const first = clips[0];
    autoplay.current = true;
    advancing.current = false;
    setError("");
    if (clip.id !== first.id) {
      select(first.id);
      return;
    }
    const video = player.current;
    if (!video) return;
    video.currentTime = first.startMs / 1000;
    void video.play().catch((reason) => {
      autoplay.current = false;
      setError(
        reason instanceof Error
          ? reason.message
          : "无法播放 / Playback unavailable",
      );
    });
  };
  const add = (id: string) => {
    const source = available.find((item) => item.id === id);
    if (!source) return;
    const item: StudioSequenceClip = {
      id: crypto.randomUUID(),
      sourceNodeId: source.id,
      title: source.title,
      url: source.metadata!.content!,
      storageKey: source.metadata?.storageKey,
      mimeType: source.metadata?.mimeType,
      durationMs: source.metadata?.durationMs,
      startMs: 0,
      endMs: null,
      volume: 1,
    };
    save([...clips, item]);
    choose(item.id);
  };
  const download = async () => {
    const controller = new AbortController();
    exportController.current = controller;
    setExporting(true);
    setError("");
    setProgress("");
    try {
      const blob = await packageStudioSequence(
        clips,
        controller.signal,
        (done, total) => {
          if (active.current) setProgress(`${done}/${total}`);
        },
      );
      if (!active.current || controller.signal.aborted) return;
      const url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${node.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "sequence"}.zip`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) {
      if (active.current && !controller.signal.aborted)
        setError(
          reason instanceof Error ? reason.message : "导出失败 / Export failed",
        );
    } finally {
      if (active.current) {
        setExporting(false);
        setProgress("");
      }
      if (exportController.current === controller)
        exportController.current = null;
    }
  };

  return (
    <section
      className="studio-sequence"
      data-studio-interactive
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      aria-label={say("视频编排", "Video sequence")}
    >
      <div className="studio-sequence-controls">
        <strong>
          <Film size={13} />
          {say("选段编排", "Sequence")}
        </strong>
        <span>
          {clips.length} {say("段", "clips")} · {timestamp(length.milliseconds)}
          {length.unknown ? "+" : ""}
        </span>
        <button
          type="button"
          onClick={begin}
          disabled={!clips.length || playing}
          title={say(
            "从第一段连续播放",
            "Play continuously from the first clip",
          )}
        >
          <Play size={13} />
          {say("串播", "Play all")}
        </button>
        <button
          type="button"
          onClick={() => {
            if (exporting) exportController.current?.abort();
            else void download();
          }}
          disabled={!clips.length}
          title={say(
            "下载真实素材与选段清单，保留编排；不渲染为单个 MP4",
            "Download source media and the edit manifest; this does not render a single MP4",
          )}
        >
          <Download size={13} />
          {exporting
            ? `${say("取消导出", "Cancel export")} ${progress}`
            : say("导出编排包", "Export package")}
        </button>
      </div>
      <div className="studio-sequence-viewer">
        {clip ? (
          <video
            key={clip.id}
            ref={player}
            src={urls[clip.id] || (clip.storageKey ? undefined : clip.url)}
            controls
            preload="metadata"
            playsInline
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              advancing.current = false;
              setError("");
              video.volume = clip.volume;
              video.currentTime = Math.min(
                clip.startMs / 1000,
                Math.max(0, video.duration - 0.001),
              );
              if (
                Number.isFinite(video.duration) &&
                Math.abs((clip.durationMs || 0) - video.duration * 1000) > 2
              )
                patch(clip.id, { durationMs: video.duration * 1000 });
              if (autoplay.current)
                void video.play().catch((reason) => {
                  autoplay.current = false;
                  setPlaying(false);
                  setError(
                    reason instanceof Error
                      ? reason.message
                      : "无法播放 / Playback unavailable",
                  );
                });
            }}
            onPlay={() => {
              setPlaying(true);
              advancing.current = false;
            }}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(event) => {
              if (
                !event.currentTarget.paused &&
                clip.endMs !== null &&
                event.currentTarget.currentTime * 1000 >= clip.endMs
              )
                next();
            }}
            onEnded={next}
            onError={() => {
              autoplay.current = false;
              setPlaying(false);
              setError(
                say(
                  "片段无法播放，请检查视频编码或源素材。",
                  "This clip cannot be played. Check its encoding or source file.",
                ),
              );
            }}
          />
        ) : (
          <div className="studio-sequence-empty">
            <Film size={28} />
            <p>
              {say(
                "连接视频节点，或从下方添加片段",
                "Connect video nodes or add a clip below",
              )}
            </p>
          </div>
        )}
      </div>
      <ol
        className="studio-sequence-rail"
        aria-label={say("片段顺序", "Clip order")}
      >
        {clips.map((item, position) => (
          <li
            key={item.id}
            className={item.id === clip?.id ? "is-current" : ""}
          >
            <button
              type="button"
              onClick={() => choose(item.id)}
              aria-pressed={item.id === clip?.id}
            >
              <span>{String(position + 1).padStart(2, "0")}</span>
              <strong>{item.title || say("视频片段", "Video clip")}</strong>
              <small>
                {timestamp(
                  (item.endMs ?? item.durationMs ?? item.startMs) -
                    item.startMs,
                )}
              </small>
            </button>
          </li>
        ))}
      </ol>
      {clip && (
        <div className="studio-sequence-editor">
          <div className="studio-sequence-order">
            <button
              type="button"
              disabled={index === 0}
              onClick={() => {
                const next = rearrangeStudioSegments(clips, clip.id, -1);
                if (next) save(next);
              }}
              title={say("前移一段", "Move earlier")}
            >
              <ArrowUp size={14} />
            </button>
            <button
              type="button"
              disabled={index === clips.length - 1}
              onClick={() => {
                const next = rearrangeStudioSegments(clips, clip.id, 1);
                if (next) save(next);
              }}
              title={say("后移一段", "Move later")}
            >
              <ArrowDown size={14} />
            </button>
            <button
              type="button"
              onClick={() =>
                patch(clip.id, { startMs: 0, endMs: null, volume: 1 })
              }
              title={say("重置选段", "Reset segment")}
            >
              <RotateCcw size={13} />
            </button>
            <button
              type="button"
              onClick={() => {
                save(clips.filter((item) => item.id !== clip.id));
                choose(clips[index + 1]?.id || clips[index - 1]?.id || "");
              }}
              title={say("移除片段", "Remove clip")}
            >
              <Trash2 size={13} />
            </button>
          </div>
          <label>
            {say("入点 / 秒", "In / seconds")}
            <input
              type="number"
              min="0"
              step="0.1"
              value={Math.round(clip.startMs) / 1000}
              onChange={(event) =>
                patch(clip.id, { startMs: event.target.valueAsNumber * 1000 })
              }
            />
          </label>
          <label>
            {say("出点 / 秒", "Out / seconds")}
            <input
              type="number"
              min={(clip.startMs + 1) / 1000}
              step="0.1"
              value={clip.endMs === null ? "" : Math.round(clip.endMs) / 1000}
              placeholder={
                clip.durationMs
                  ? (clip.durationMs / 1000).toFixed(1)
                  : say("至片尾", "To end")
              }
              onChange={(event) =>
                patch(clip.id, {
                  endMs:
                    event.target.value === ""
                      ? null
                      : event.target.valueAsNumber * 1000,
                })
              }
            />
          </label>
          <label className="studio-sequence-volume">
            {say("音量", "Volume")} {Math.round(clip.volume * 100)}%
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={clip.volume}
              onChange={(event) =>
                patch(clip.id, { volume: event.target.valueAsNumber })
              }
            />
          </label>
        </div>
      )}
      <div className="studio-sequence-add">
        <Plus size={13} />
        <select
          value=""
          aria-label={say("添加视频片段", "Add a video clip")}
          onChange={(event) => add(event.target.value)}
        >
          <option value="">
            {say("从画布添加视频…", "Add video from canvas…")}
          </option>
          {available.map((item) => (
            <option key={item.id} value={item.id}>
              {linked.has(item.id) ? "↳ " : ""}
              {item.title}
            </option>
          ))}
        </select>
        <span
          title={say(
            "优先显示输入连接的视频",
            "Input-connected videos are listed first",
          )}
        >
          <Link2 size={12} />
          {linked.size}
        </span>
      </div>
      {error && (
        <p className="studio-sequence-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
