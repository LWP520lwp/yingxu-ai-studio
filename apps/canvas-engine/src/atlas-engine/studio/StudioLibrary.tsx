import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "antd";
import { useTranslation } from "react-i18next";
import {
  AudioLines,
  BookOpen,
  Check,
  ChevronDown,
  FileText,
  Image,
  LoaderCircle,
  Search,
  Upload,
  Video,
  X,
} from "lucide-react";
import { useAssetStore } from "@/stores/use-asset-store";
import {
  getPlatformInit,
  platformRequest,
  type PlatformAsset,
} from "@/platform/rpc";
import type { InsertAssetPayload } from "@/atlas-engine/ui/asset-picker";
import type { CanvasNodeData } from "@/types/canvas";
import {
  canvasLibraryItems,
  filterLibraryItems,
  libraryTextAddress,
  localLibraryItems,
  projectLibraryItems,
  type LibraryItem,
  type LibraryKind,
  type LibrarySource,
} from "./studio-library-model";
import "./studio-library.css";

type RemoteSource = "project" | "account";
type RemoteState = { assets: PlatformAsset[]; loading: boolean; error: string };
const NO_NODES: readonly CanvasNodeData[] = [];
const kindIcons = {
  text: FileText,
  image: Image,
  video: Video,
  audio: AudioLines,
};

function sizeLabel(bytes?: number) {
  if (!bytes || bytes < 0) return "";
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function MaterialVisual({
  item,
  expanded = false,
  unavailable,
}: {
  item: LibraryItem;
  expanded?: boolean;
  unavailable: string;
}) {
  const [failed, setFailed] = useState(false);
  const Icon = kindIcons[item.kind];
  const url = item.payload && "url" in item.payload ? item.payload.url : "";
  useEffect(() => setFailed(false), [item.id, item.preview, url]);
  if (
    !failed &&
    item.preview &&
    (item.kind === "image" || (!expanded && item.kind === "video"))
  )
    return (
      <img
        src={item.preview}
        alt={expanded ? item.title : ""}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  if (expanded && !failed && item.kind === "video" && url)
    return (
      <video
        key={url}
        src={url}
        controls
        playsInline
        preload="metadata"
        onError={() => setFailed(true)}
      />
    );
  if (expanded && !failed && item.kind === "audio" && url)
    return (
      <div className="studio-material-audio">
        <AudioLines size={40} />
        <audio
          key={url}
          src={url}
          controls
          preload="metadata"
          onError={() => setFailed(true)}
        />
      </div>
    );
  return (
    <div className={`studio-material-placeholder is-${item.kind}`}>
      <Icon size={expanded ? 40 : 28} />
      {item.kind === "text" && item.excerpt && <p>{item.excerpt}</p>}
      {failed && <small>{unavailable}</small>}
    </div>
  );
}

export default function StudioLibrary({
  onClose,
  onInsert,
  nodes = NO_NODES,
  onUpload,
  embedded = false,
  insertLabel,
  referenceOnly = false,
}: {
  onClose: () => void;
  onInsert: (value: InsertAssetPayload) => void | Promise<void>;
  nodes?: readonly CanvasNodeData[];
  onUpload?: () => void;
  embedded?: boolean;
  insertLabel?: string;
  referenceOnly?: boolean;
}) {
  const { i18n } = useTranslation();
  const zh = !i18n.resolvedLanguage?.startsWith("en");
  const word = (cn: string, en: string) => (zh ? cn : en);
  const local = useAssetStore((state) => state.assets);
  const hydrated = useAssetStore((state) => state.hydrated);
  const [source, setSource] = useState<LibrarySource>("account");
  const [kind, setKind] = useState<LibraryKind | "all">("all");
  const activeKind =
    referenceOnly && (kind === "video" || kind === "audio") ? "all" : kind;
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [previewId, setPreviewId] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [inserting, setInserting] = useState("");
  const [insertError, setInsertError] = useState("");
  const alive = useRef(true);
  const insertAbort = useRef<AbortController | null>(null);
  const [remote, setRemote] = useState<Record<RemoteSource, RemoteState>>(
    () => ({
      project: {
        assets: getPlatformInit()?.assets || [],
        loading: true,
        error: "",
      },
      account: { assets: [], loading: true, error: "" },
    }),
  );

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      insertAbort.current?.abort();
    };
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    for (const scope of ["project", "account"] as const) {
      setRemote((current) => ({
        ...current,
        [scope]: { ...current[scope], loading: true, error: "" },
      }));
      void platformRequest<PlatformAsset[]>(
        "assets.list",
        scope === "account" ? { scope: "account" } : {},
        { signal: abort.signal, timeoutMs: 25_000 },
      )
        .then((assets) => {
          if (!Array.isArray(assets))
            throw new Error(
              word(
                "素材列表返回格式不正确，请重试。",
                "The materials response was invalid. Try again.",
              ),
            );
          if (!abort.signal.aborted)
            setRemote((current) => ({
              ...current,
              [scope]: { assets, loading: false, error: "" },
            }));
        })
        .catch((reason: unknown) => {
          if (!abort.signal.aborted)
            setRemote((current) => ({
              ...current,
              [scope]: {
                ...current[scope],
                loading: false,
                error:
                  reason instanceof Error
                    ? reason.message
                    : word(
                        "素材加载失败，请重试。",
                        "Could not load materials. Try again.",
                      ),
              },
            }));
        });
    }
    return () => abort.abort();
  }, [refresh]);

  const collection = useMemo(() => {
    const eligible = (items: LibraryItem[]) =>
      referenceOnly
        ? items.filter((item) => item.kind === "image" || item.kind === "text")
        : items;
    return {
      local: eligible(localLibraryItems(local)),
      project: eligible(projectLibraryItems(remote.project.assets)),
      canvas: eligible(canvasLibraryItems(nodes)),
      account: eligible(projectLibraryItems(remote.account.assets, "account")),
    };
  }, [
    local,
    nodes,
    remote.project.assets,
    remote.account.assets,
    referenceOnly,
  ]);
  const visible = useMemo(
    () => filterLibraryItems(collection[source], activeKind, query),
    [collection, source, activeKind, query],
  );
  const selected = visible.find((item) => item.id === selectedId) || visible[0];
  const loading =
    source === "local"
      ? !hydrated
      : source === "canvas"
        ? false
        : remote[source].loading;
  const loadError =
    source === "project" || source === "account" ? remote[source].error : "";
  const kindNames = {
    all: word("全部类型", "All types"),
    image: word("图片", "Images"),
    video: word("视频", "Videos"),
    text: word("文本", "Text"),
    audio: word("音频", "Audio"),
  };
  const sources: { id: LibrarySource; title: string; hint: string }[] = [
    {
      id: "project",
      title: word("项目资源", "This project"),
      hint: word(
        "当前草稿的上传与生成结果",
        "Uploads and outputs in this draft",
      ),
    },
    {
      id: "canvas",
      title: word("画布素材", "On this canvas"),
      hint: word(
        "所有素材节点，包含批次结果",
        "Material nodes, including batch results",
      ),
    },
    {
      id: "local",
      title: word("本地收藏", "Saved locally"),
      hint: word(
        "当前浏览器和草稿保存的收藏",
        "Saved in this browser for this draft",
      ),
    },
    {
      id: "account",
      title: word("账号资源", "Your account"),
      hint: word(
        "当前账号各项目的最近 200 项资源",
        "Up to 200 recent assets across your projects",
      ),
    },
  ];
  const currentSource = sources.find((tab) => tab.id === source)!;

  async function insert(item: LibraryItem) {
    if (inserting) return;
    if (referenceOnly && item.kind !== "image" && item.kind !== "text") {
      setInsertError(
        word(
          "请选择图片或文字作为参考。",
          "Choose an image or text as a reference.",
        ),
      );
      return;
    }
    const abort = new AbortController();
    insertAbort.current = abort;
    setInserting(item.id);
    setInsertError("");
    try {
      let payload = item.payload;
      if (!payload && item.textUrl) {
        const url = libraryTextAddress(item.textUrl, location.origin);
        if (!url)
          throw new Error(
            word(
              "文本素材地址无效，请重新上传这个文件。",
              "This text address is invalid. Upload the file again.",
            ),
          );
        const response = await fetch(url, {
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20_000)]),
          credentials: "same-origin",
        });
        if (!response.ok)
          throw new Error(
            word(
              "文本内容暂时无法读取，请重试。",
              "The text could not be read. Try again.",
            ),
          );
        const content = await response.text();
        if (content.length > 1_000_000)
          throw new Error(
            word(
              "文本超过 100 万字符，请拆分后导入。",
              "Split text exceeding one million characters before importing.",
            ),
          );
        payload = { kind: "text", title: item.title, content };
      }
      if (!payload)
        throw new Error(
          word(
            "这份素材暂时无法插入。",
            "This material cannot be inserted yet.",
          ),
        );
      if (!abort.signal.aborted && alive.current) await onInsert(payload);
    } catch (reason) {
      if (!abort.signal.aborted && alive.current)
        setInsertError(
          reason instanceof Error
            ? reason.message
            : word("插入失败，请重试。", "Insertion failed. Try again."),
        );
    } finally {
      if (alive.current) setInserting("");
      if (insertAbort.current === abort) insertAbort.current = null;
    }
  }

  const resetFilters = () => {
    setQuery("");
    setKind("all");
  };
  const panel = (
    <section
      className={`studio-material-library${embedded ? " is-embedded" : ""}`}
      aria-label={word("素材库", "Material library")}
    >
      <header className="studio-material-header">
        <div>
          {!embedded && (
            <span className="studio-material-eyebrow">MATERIAL LIBRARY</span>
          )}
          <h2>{word("资产库", "Asset library")}</h2>
          {!embedded && (
            <p>
              {word(
                "上传、收藏与生成内容，随时回到画布复用。",
                "Bring uploads, saved references and generated work back to your canvas.",
              )}
            </p>
          )}
        </div>
        <div className="studio-material-header-actions">
          {onUpload && (
            <button
              type="button"
              className="studio-material-upload"
              onClick={onUpload}
              aria-label={word("上传素材", "Upload")}
              title={word("上传素材", "Upload")}
            >
              <Upload size={16} />
              <span>{word("上传素材", "Upload")}</span>
            </button>
          )}
          <button
            type="button"
            className="studio-material-dismiss"
            aria-label={word("关闭素材库", "Close library")}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
      </header>
      <nav
        className="studio-material-sources"
        aria-label={word("素材来源", "Material sources")}
      >
        {sources.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={source === tab.id}
            onClick={() => {
              setSource(tab.id);
              setSelectedId("");
              setInsertError("");
            }}
          >
            <span>{tab.title}</span>
            <b>
              {tab.id === "local" && !hydrated
                ? "…"
                : collection[tab.id].length}
            </b>
          </button>
        ))}
      </nav>
      <div className="studio-material-controls">
        <label className="studio-material-search">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={word(
              "搜索名称、标签或文本内容",
              "Search names, tags or text",
            )}
            aria-label={word("搜索素材", "Search materials")}
          />
        </label>
        <select
          aria-label={word("素材类型", "Material type")}
          value={activeKind}
          onChange={(event) =>
            setKind(event.target.value as LibraryKind | "all")
          }
        >
          {Object.entries(kindNames)
            .filter(
              ([id]) =>
                !referenceOnly ||
                id === "all" ||
                id === "image" ||
                id === "text",
            )
            .map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
        </select>
        <button
          type="button"
          className="studio-material-refresh"
          disabled={loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          {loading && (
            <LoaderCircle size={14} className="studio-material-spinner" />
          )}
          {loading ? word("加载中", "Loading") : word("刷新资源", "Refresh")}
        </button>
      </div>
      <div className="studio-material-source-description">
        <span title={currentSource.hint}>
          {referenceOnly
            ? word(
                "选择图片或文字作为当前节点参考",
                "Choose an image or text to reference in this node",
              )
            : embedded
              ? word("双击素材快速添加", "Double-click to add")
              : currentSource.hint}
        </span>
        <span aria-live="polite">
          {word(`${visible.length} 项`, `${visible.length} items`)}
        </span>
      </div>
      {loadError && (
        <div className="studio-material-error" role="alert">
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() => setRefresh((value) => value + 1)}
          >
            {word("重试加载", "Retry")}
          </button>
        </div>
      )}
      {insertError && (
        <div className="studio-material-error" role="alert">
          {insertError}
        </div>
      )}
      <div className="studio-material-body" aria-busy={loading}>
        <div className="studio-material-results">
          {visible.length > 0 ? (
            <div className="studio-material-grid">
              {visible.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`studio-material-card${selected?.id === item.id ? " is-selected" : ""}`}
                  aria-pressed={selected?.id === item.id}
                  onClick={() => {
                    setSelectedId(item.id);
                    setInsertError("");
                  }}
                  onDoubleClick={() => void insert(item)}
                >
                  <div className="studio-material-card-preview">
                    <MaterialVisual
                      item={item}
                      unavailable={word("预览不可用", "Preview unavailable")}
                    />
                    {selected?.id === item.id && (
                      <span className="studio-material-selected">
                        <Check size={13} />
                      </span>
                    )}
                  </div>
                  <div className="studio-material-card-copy">
                    <strong title={item.title}>
                      {item.title || word("未命名素材", "Untitled material")}
                    </strong>
                    <span>
                      {kindNames[item.kind]}
                      <small>{sizeLabel(item.bytes)}</small>
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="studio-material-empty" role="status">
              {loading ? (
                <LoaderCircle size={30} className="studio-material-spinner" />
              ) : (
                <BookOpen size={34} />
              )}
              <h3>
                {loading
                  ? word("正在读取真实素材…", "Loading your materials…")
                  : query.trim() || activeKind !== "all"
                    ? word("没有匹配的素材", "No matching materials")
                    : word("这里还没有素材", "No materials here yet")}
              </h3>
              <p>
                {loading
                  ? word(
                      "保留原有内容，读取完成后会自动显示。",
                      "Your saved content will appear when loading completes.",
                    )
                  : query.trim() || activeKind !== "all"
                    ? word(
                        "换个关键词，或查看其他类型。",
                        "Try another keyword or material type.",
                      )
                    : source === "local"
                      ? word(
                          "在画布中选中一个素材，使用收藏即可保存在这里。",
                          "Save a material from a canvas node to keep it here.",
                        )
                      : source === "canvas"
                        ? word(
                            "把图片、视频、文本或音频加入画布后，就可以在这里找到。",
                            "Images, video, text and audio on the canvas appear here.",
                          )
                        : word(
                            "上传文件或完成一次生成，资源会保留在对应项目中。",
                            "Upload a file or generate something to start your collection.",
                          )}
              </p>
              {(query.trim() || activeKind !== "all") && !loading && (
                <button type="button" onClick={resetFilters}>
                  {word("清除筛选", "Clear filters")}
                </button>
              )}
            </div>
          )}
        </div>
        {selected && (
          <aside className="studio-material-detail">
            {embedded && (
              <button
                type="button"
                className="studio-material-preview-toggle"
                aria-expanded={previewId === selected.id}
                onClick={() =>
                  setPreviewId(previewId === selected.id ? "" : selected.id)
                }
              >
                <span>
                  {previewId === selected.id
                    ? word("收起预览", "Hide preview")
                    : word("预览素材", "Preview material")}
                </span>
                <ChevronDown size={14} />
              </button>
            )}
            {(!embedded || previewId === selected.id) && (
              <div className="studio-material-detail-preview">
                <MaterialVisual
                  key={selected.id}
                  item={selected}
                  expanded
                  unavailable={word(
                    "文件预览失败，原始记录仍保留",
                    "Preview unavailable; the original record is retained",
                  )}
                />
              </div>
            )}
            <span className="studio-material-detail-type">
              {kindNames[selected.kind]}
              {sizeLabel(selected.bytes) && ` · ${sizeLabel(selected.bytes)}`}
            </span>
            <h3>{selected.title || word("未命名素材", "Untitled material")}</h3>
            {selected.kind === "text" &&
              selected.excerpt &&
              (!embedded || previewId === selected.id) && (
                <p className="studio-material-full-text">{selected.excerpt}</p>
              )}
            <p className="studio-material-insert-hint">
              {word(
                "将这份素材加入当前画布，接着创作。",
                "Bring this material into your canvas and keep creating.",
              )}
            </p>
            <button
              type="button"
              className="studio-material-insert"
              disabled={Boolean(inserting)}
              onClick={() => void insert(selected)}
            >
              {inserting === selected.id && (
                <LoaderCircle size={16} className="studio-material-spinner" />
              )}
              {inserting === selected.id
                ? word("正在插入…", "Inserting…")
                : insertLabel || word("插入画布", "Insert into canvas")}
            </button>
          </aside>
        )}
      </div>
    </section>
  );
  return embedded ? (
    panel
  ) : (
    <Modal
      open
      title={null}
      footer={null}
      onCancel={onClose}
      width={1120}
      destroyOnHidden
      className="studio-material-modal"
      closeIcon={null}
    >
      {panel}
    </Modal>
  );
}
