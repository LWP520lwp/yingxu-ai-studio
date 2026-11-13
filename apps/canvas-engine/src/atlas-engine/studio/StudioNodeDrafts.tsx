import { useDeferredValue, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AudioLines,
  Blocks,
  Check,
  FileText,
  Focus,
  Frame,
  Image,
  Plus,
  Search,
  Settings2,
  Video,
  X,
} from "lucide-react";
import type { CanvasNodeData, CanvasNodeStatus } from "@/types/canvas";
import {
  filterNodeDrafts,
  NODE_DRAFT_KINDS,
  projectNodeDrafts,
  type NodeDraftKind,
} from "./studio-node-drafts";
import "./studio-node-drafts.css";

export type StudioNodeDraftsProps = {
  nodes: readonly CanvasNodeData[];
  selection: ReadonlySet<string>;
  onFocus: (id: string) => void;
  onClose: () => void;
  onCreate: (type: string) => void;
};

const PAGE_SIZE = 80;
const KIND_ICONS = {
  text: FileText,
  image: Image,
  video: Video,
  audio: AudioLines,
  config: Settings2,
  group: Frame,
  extension: Blocks,
};
const STATUSES = ["idle", "loading", "success", "error"] as const;

export function StudioNodeDrafts({
  nodes,
  selection,
  onFocus,
  onClose,
  onCreate,
}: StudioNodeDraftsProps) {
  const { i18n } = useTranslation();
  const zh = !i18n.resolvedLanguage?.startsWith("en");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<NodeDraftKind | "all">("all");
  const [status, setStatus] = useState<CanvasNodeStatus | "all">("all");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const deferredQuery = useDeferredValue(query);
  const items = useMemo(() => projectNodeDrafts(nodes), [nodes]);
  const matches = useMemo(
    () => filterNodeDrafts(items, { query: deferredQuery, kind, status }),
    [items, deferredQuery, kind, status],
  );
  const kinds: Record<NodeDraftKind, string> = zh
    ? {
        text: "文本",
        image: "图片",
        video: "视频",
        audio: "音频",
        config: "生成配置",
        group: "分组",
        extension: "扩展节点",
      }
    : {
        text: "Text",
        image: "Image",
        video: "Video",
        audio: "Audio",
        config: "Generation",
        group: "Group",
        extension: "Extension",
      };
  const statuses: Record<CanvasNodeStatus, string> = zh
    ? { idle: "未生成", loading: "生成中", success: "已完成", error: "需处理" }
    : {
        idle: "Idle",
        loading: "Running",
        success: "Ready",
        error: "Needs attention",
      };
  const filtered = query.trim() || kind !== "all" || status !== "all";
  const title = zh ? "节点草稿" : "Node drafts";
  return (
    <section className="studio-node-drafts" aria-label={title}>
      <header className="studio-node-drafts-header">
        <div>
          <h2>{title}</h2>
          <p>{zh ? "当前画布的全部节点" : "Every node on this canvas"}</p>
        </div>
        <button
          type="button"
          className="studio-node-drafts-close"
          onClick={onClose}
          title={zh ? "关闭节点草稿" : "Close node drafts"}
          aria-label={zh ? "关闭节点草稿" : "Close node drafts"}
        >
          <X size={17} />
        </button>
      </header>
      <div className="studio-node-drafts-controls">
        <label className="studio-node-drafts-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder={
              zh ? "搜索名称、文字或模型" : "Search name, text or model"
            }
            aria-label={zh ? "搜索节点草稿" : "Search node drafts"}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(PAGE_SIZE);
            }}
          />
        </label>
        <div className="studio-node-drafts-filters">
          <select
            value={kind}
            aria-label={zh ? "节点类型" : "Node type"}
            onChange={(event) => {
              setKind(event.target.value as NodeDraftKind | "all");
              setLimit(PAGE_SIZE);
            }}
          >
            <option value="all">{zh ? "全部类型" : "All types"}</option>
            {NODE_DRAFT_KINDS.map((value) => (
              <option key={value} value={value}>
                {kinds[value]}
              </option>
            ))}
          </select>
          <select
            value={status}
            aria-label={zh ? "节点状态" : "Node status"}
            onChange={(event) => {
              setStatus(event.target.value as CanvasNodeStatus | "all");
              setLimit(PAGE_SIZE);
            }}
          >
            <option value="all">{zh ? "全部状态" : "All statuses"}</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {statuses[value]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="studio-node-drafts-count" role="status">
        <span>{zh ? "本画布" : "This canvas"}</span>
        <span>
          {matches.length} / {items.length}
        </span>
      </div>
      <div
        className="studio-node-drafts-list"
        aria-busy={query !== deferredQuery}
      >
        {matches.length === 0 ? (
          <div className="studio-node-drafts-empty">
            <Frame size={26} strokeWidth={1.4} aria-hidden="true" />
            <strong>
              {filtered
                ? zh
                  ? "没有匹配的节点"
                  : "No matching nodes"
                : zh
                  ? "从一个节点开始"
                  : "Start with a node"}
            </strong>
            <p>
              {filtered
                ? zh
                  ? "调整搜索或筛选条件后再试。"
                  : "Try another search or filter."
                : zh
                  ? "新建的节点会自动出现在这里，空节点也会保留。"
                  : "New nodes appear here automatically, including empty nodes."}
            </p>
            {filtered && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setKind("all");
                  setStatus("all");
                  setLimit(PAGE_SIZE);
                }}
              >
                {zh ? "清除筛选" : "Clear filters"}
              </button>
            )}
          </div>
        ) : (
          <>
            {matches.slice(0, limit).map((item) => {
              const Icon = KIND_ICONS[item.kind];
              const selected = selection.has(item.id);
              const name =
                item.title ||
                (zh
                  ? `未命名${kinds[item.kind]}`
                  : `Untitled ${kinds[item.kind].toLowerCase()}`);
              const emptyLabel =
                item.kind === "group"
                  ? zh
                    ? `${item.childCount} 个节点`
                    : `${item.childCount} nodes`
                  : zh
                    ? "尚未填写内容"
                    : "No content yet";
              return (
                <button
                  type="button"
                  key={item.id}
                  className="studio-node-draft-row"
                  aria-pressed={selected}
                  aria-label={zh ? `定位节点：${name}` : `Locate node: ${name}`}
                  title={
                    zh ? "点击定位并选中节点" : "Locate and select this node"
                  }
                  onClick={() => onFocus(item.id)}
                >
                  <span className={`studio-node-draft-icon is-${item.kind}`}>
                    <Icon size={17} strokeWidth={1.6} aria-hidden="true" />
                  </span>
                  <span className="studio-node-draft-info">
                    <span className="studio-node-draft-title">{name}</span>
                    <span className="studio-node-draft-summary">
                      {item.summary || emptyLabel}
                    </span>
                    <span className="studio-node-draft-meta">
                      <span>{kinds[item.kind]}</span>
                      <span
                        className={`studio-node-draft-status is-${item.status}`}
                      >
                        {statuses[item.status]}
                      </span>
                      {item.model && (
                        <span
                          className="studio-node-draft-model"
                          title={item.model}
                        >
                          {item.model}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="studio-node-draft-focus" aria-hidden="true">
                    {selected ? <Check size={14} /> : <Focus size={14} />}
                  </span>
                </button>
              );
            })}
            {matches.length > limit && (
              <button
                type="button"
                className="studio-node-drafts-more"
                onClick={() => setLimit((value) => value + PAGE_SIZE)}
              >
                {zh
                  ? `继续显示（剩余 ${matches.length - limit}）`
                  : `Show more (${matches.length - limit} remaining)`}
              </button>
            )}
          </>
        )}
      </div>
      <footer className="studio-node-drafts-footer">
        <button
          type="button"
          className="studio-node-drafts-create"
          onClick={() => onCreate("text")}
        >
          <Plus size={15} aria-hidden="true" />
          {zh ? "新建文本节点" : "New text node"}
        </button>
        <p>
          {zh
            ? "随画布保存，点击任一草稿可定位节点。"
            : "Saved with your canvas. Click a draft to locate its node."}
        </p>
      </footer>
    </section>
  );
}

export default StudioNodeDrafts;
