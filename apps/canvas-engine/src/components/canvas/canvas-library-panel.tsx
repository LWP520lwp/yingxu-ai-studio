import { App, Empty, Input, Select, Spin } from "antd";
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Image as ImageIcon,
  LayoutGrid,
  ListChecks,
  Music2,
  Plus,
  Rows3,
  Search,
  Settings2,
  Square,
  Trash2,
  Type,
  Video,
} from "lucide-react";
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import {
  filterPickerAssets,
  toInsertAssetPayload,
  type AssetPickerKindFilter,
  type InsertAssetPayload,
} from "@/lib/canvas/asset-picker";
import {
  deriveCanvasNodePanelModel,
  toggleCanvasNodeSelection,
  toggleVisibleCanvasNodeSelection,
} from "@/lib/canvas/canvas-side-panel-model";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { cn } from "@/lib/utils";
import { PromptDetailDialog } from "@/pages/prompts/components/prompt-detail-dialog";
import { fetchSourcePrompts, type Prompt } from "@/services/api/prompts";
import { uploadMediaFile } from "@/services/file-storage";
import {
  getImagePreviewRevision,
  previewUrlFor,
  subscribeImagePreviews,
  uploadImage,
} from "@/services/image-storage";
import {
  assetCoverUrl,
  useAssetStore,
  type Asset,
} from "@/stores/use-asset-store";
import { usePromptSourceStore } from "@/stores/use-prompt-source-store";
import {
  CANVAS_SIDE_PANEL_MAX_WIDTH,
  CANVAS_SIDE_PANEL_MIN_WIDTH,
  useCanvasSidePanelStore,
} from "@/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

type PanelProps = {
  nodes: CanvasNodeData[];
  selectedNodeIds: Set<string>;
  onFocusNode: (nodeId: string) => void;
  onPreviewNode: (nodeId: string) => void;
  onHoverNode: (nodeId: string | null) => void;
  onInsertAsset: (payload: InsertAssetPayload) => void;
};

const nodeIcons: Record<string, typeof Square> = {
  [CanvasNodeType.Image]: ImageIcon,
  [CanvasNodeType.Video]: Video,
  [CanvasNodeType.Audio]: Music2,
  [CanvasNodeType.Text]: Type,
  [CanvasNodeType.Config]: Settings2,
  [CanvasNodeType.Group]: Square,
};

const nodeFilters = [
  "all",
  CanvasNodeType.Image,
  CanvasNodeType.Video,
  CanvasNodeType.Text,
  CanvasNodeType.Audio,
  CanvasNodeType.Config,
  CanvasNodeType.Group,
];

export function CanvasSidePanel(props: PanelProps) {
  const { t } = useTranslation();
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const activeTab = useCanvasSidePanelStore((state) => state.activeTab);
  const setActiveTab = useCanvasSidePanelStore((state) => state.setActiveTab);
  const width = useCanvasSidePanelStore((state) => state.width);
  const setWidth = useCanvasSidePanelStore((state) => state.setWidth);
  const panelOpen = useCanvasSidePanelStore((state) => state.panelOpen);
  const panelMounted = useCanvasSidePanelStore((state) => state.panelMounted);
  const panelClosing = useCanvasSidePanelStore((state) => state.panelClosing);
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef<{
    x: number;
    width: number;
    pointerId: number;
  } | null>(null);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const next = Math.min(
        CANVAS_SIDE_PANEL_MAX_WIDTH,
        Math.max(
          CANVAS_SIDE_PANEL_MIN_WIDTH,
          drag.width + event.clientX - drag.x,
        ),
      );
      setWidth(next);
    };
    const finish = (event: PointerEvent) => {
      if (dragRef.current?.pointerId !== event.pointerId) return;
      dragRef.current = null;
      setResizing(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [setWidth]);

  if (!panelMounted) return null;

  return (
    <aside
      className="canvas-atlas-panel relative z-[60] flex h-full shrink-0 overflow-hidden border-r transition-[width,opacity]"
      style={{
        width: panelOpen ? width : 0,
        opacity: panelOpen ? 1 : 0,
        transitionDuration: resizing ? "0ms" : "220ms",
        pointerEvents: panelClosing ? "none" : undefined,
        background: theme.toolbar.panel,
        borderColor: theme.toolbar.border,
        color: theme.node.text,
      }}
      aria-hidden={!panelOpen}
      data-canvas-no-zoom
    >
      <div className="flex h-full min-w-0 flex-1 flex-col" style={{ width }}>
        <header
          className="flex h-12 shrink-0 items-center justify-between border-b px-3"
          style={{ borderColor: theme.toolbar.border }}
        >
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">
              {t(`canvas.sidePanel.${activeTab}`)}
            </h2>
            <div className="text-[11px] opacity-50">
              {activeTab === "canvas"
                ? t("canvas.sidePanel.elements")
                : activeTab === "assets"
                  ? t("canvas.sidePanel.assets")
                  : t("canvas.sidePanel.prompts")}
            </div>
          </div>
          {activeTab === "canvas" ? (
            <span className="text-xs tabular-nums opacity-50">
              {props.nodes.length}
            </span>
          ) : null}
        </header>
        <nav
          className="grid shrink-0 grid-cols-3 gap-1 border-b p-2"
          style={{ borderColor: theme.toolbar.border }}
          aria-label={t("canvas.sidePanel.title")}
        >
          {(["canvas", "assets", "prompts"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              aria-current={activeTab === tab ? "page" : undefined}
              className={cn(
                "min-h-9 rounded-md px-2 text-xs font-medium transition",
                activeTab === tab
                  ? "bg-black/10 dark:bg-white/10"
                  : "opacity-65 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/5",
              )}
            >
              {t(`canvas.sidePanel.${tab}`)}
            </button>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-hidden">
          {activeTab === "canvas" ? (
            <NodeBrowser {...props} theme={theme} />
          ) : null}
          {activeTab === "assets" ? (
            <AssetBrowser theme={theme} onInsert={props.onInsertAsset} />
          ) : null}
          {activeTab === "prompts" ? (
            <PromptBrowser theme={theme} onInsert={props.onInsertAsset} />
          ) : null}
        </div>
      </div>
      <button
        type="button"
        className="absolute inset-y-0 right-0 z-10 w-2 translate-x-1/2 cursor-col-resize touch-none"
        aria-label={t("canvas.sidePanel.resize")}
        onPointerDown={(event) => {
          event.preventDefault();
          dragRef.current = {
            x: event.clientX,
            width,
            pointerId: event.pointerId,
          };
          setResizing(true);
        }}
      />
    </aside>
  );
}

function NodeBrowser({
  nodes,
  selectedNodeIds,
  onFocusNode,
  onPreviewNode,
  onHoverNode,
  theme,
}: PanelProps & { theme: CanvasTheme }) {
  const { message } = App.useApp();
  const { t } = useTranslation();
  useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selecting, setSelecting] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const viewMode = useCanvasSidePanelStore((state) => state.nodeViewMode);
  const setViewMode = useCanvasSidePanelStore((state) => state.setNodeViewMode);
  const model = useMemo(
    () =>
      deriveCanvasNodePanelModel(nodes, {
        query,
        typeFilter: filter,
        collapsedGroupIds: collapsed,
      }),
    [nodes, query, filter, collapsed],
  );
  const exitSelection = () => {
    setSelecting(false);
    setChecked(new Set());
  };
  const toggleNode = (id: string) =>
    setChecked((value) => toggleCanvasNodeSelection(value, id));
  const allVisible =
    model.filteredNodes.length > 0 &&
    model.filteredNodes.every((node) => checked.has(node.id));
  const toggleVisible = () =>
    setChecked((value) =>
      toggleVisibleCanvasNodeSelection(
        value,
        model.filteredNodes.map((node) => node.id),
      ),
    );
  const exportSelection = async () => {
    const chosen = nodes.filter((node) => checked.has(node.id));
    if (!chosen.length) return;
    setExporting(true);
    const hide = message.loading(t("canvas.sidePanel.exporting"), 0);
    try {
      const { exportCanvasNodes } = await import("@/lib/canvas/canvas-export");
      await exportCanvasNodes(
        chosen,
        t("canvas.sidePanel.exportName", { count: chosen.length }),
      );
      message.success(t("canvas.sidePanel.exported", { count: chosen.length }));
      exitSelection();
    } catch {
      message.error(t("canvas.sidePanel.exportFailed"));
    } finally {
      hide();
      setExporting(false);
    }
  };
  const activate = (node: CanvasNodeData) => {
    if (
      (node.type === CanvasNodeType.Image ||
        node.type === CanvasNodeType.Video) &&
      node.metadata?.content
    ) {
      onPreviewNode(node.id);
      return;
    }
    onFocusNode(node.id);
  };

  return (
    <section
      className="flex h-full flex-col"
      onMouseLeave={() => onHoverNode(null)}
    >
      <div className="flex items-center gap-2 px-3 pt-3">
        <Input
          size="small"
          allowClear
          prefix={<Search size={14} />}
          placeholder={t("canvas.sidePanel.searchNodes")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          type="button"
          className="grid size-8 shrink-0 place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/5"
          title={
            viewMode === "grid"
              ? t("canvas.sidePanel.viewList")
              : t("canvas.sidePanel.viewGrid")
          }
          aria-label={
            viewMode === "grid"
              ? t("canvas.sidePanel.viewList")
              : t("canvas.sidePanel.viewGrid")
          }
          onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")}
        >
          {viewMode === "grid" ? <Rows3 size={15} /> : <LayoutGrid size={15} />}
        </button>
      </div>
      <div className="flex items-center gap-2 px-3 py-2">
        <Select
          size="small"
          className="min-w-0 flex-1"
          value={filter}
          onChange={setFilter}
          options={nodeFilters.map((value) => ({
            value,
            label:
              value === "all"
                ? t("common.all")
                : t(`canvas.sidePanel.filter.${value}`),
          }))}
        />
        <button
          type="button"
          onClick={() => (selecting ? exitSelection() : setSelecting(true))}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-black/5 dark:hover:bg-white/5"
        >
          <ListChecks size={14} />
          {selecting ? t("common.cancel") : t("canvas.sidePanel.select")}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {model.rows.length ? (
          <div
            className={
              viewMode === "grid"
                ? "grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(88px,1fr))]"
                : "space-y-1"
            }
          >
            {model.rows.map(({ node, depth, hasChildren }) => {
              const Icon = nodeIcons[node.type] || FileText;
              const image =
                node.type === CanvasNodeType.Image && node.metadata?.content;
              const active = selecting
                ? checked.has(node.id)
                : selectedNodeIds.has(node.id);
              return (
                <div
                  key={node.id}
                  className={cn(
                    "group relative min-w-0 rounded-md transition",
                    viewMode === "grid" ? "p-1" : "flex items-center",
                    active && "bg-black/10 dark:bg-white/10",
                    !active && "hover:bg-black/5 dark:hover:bg-white/5",
                  )}
                  style={{
                    marginLeft: viewMode === "list" ? depth * 14 : undefined,
                  }}
                  onMouseEnter={() => onHoverNode(node.id)}
                >
                  {viewMode === "list" &&
                  node.type === CanvasNodeType.Group &&
                  hasChildren ? (
                    <button
                      type="button"
                      className="grid size-7 shrink-0 place-items-center opacity-60"
                      aria-label={node.title}
                      onClick={() =>
                        setCollapsed((value) =>
                          value.has(node.id)
                            ? new Set([...value].filter((id) => id !== node.id))
                            : new Set(value).add(node.id),
                        )
                      }
                    >
                      {collapsed.has(node.id) ? (
                        <ChevronRight size={14} />
                      ) : (
                        <ChevronDown size={14} />
                      )}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={cn(
                      "min-w-0 text-left",
                      viewMode === "grid"
                        ? "flex w-full flex-col"
                        : "flex flex-1 items-center gap-2 py-1.5 pr-2",
                    )}
                    onClick={() =>
                      selecting ? toggleNode(node.id) : activate(node)
                    }
                    title={t("canvas.sidePanel.focusNode")}
                  >
                    {selecting ? (
                      <span className="absolute left-2 top-2 z-10 grid size-4 place-items-center rounded border bg-white/90 text-sky-600 dark:bg-zinc-900">
                        {checked.has(node.id) ? <Check size={12} /> : null}
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        "relative grid shrink-0 place-items-center overflow-hidden rounded",
                        viewMode === "grid" ? "aspect-square w-full" : "size-9",
                      )}
                      style={{ background: theme.node.panel }}
                    >
                      {image ? (
                        <img
                          src={
                            previewUrlFor(node.metadata?.storageKey) ||
                            node.metadata?.content
                          }
                          alt={node.title}
                          className="size-full object-cover"
                        />
                      ) : (
                        <Icon className="size-5 opacity-60" />
                      )}
                      {node.metadata?.status &&
                      node.metadata.status !== "idle" ? (
                        <i
                          className="absolute right-1 top-1 size-1.5 rounded-full"
                          style={{
                            background:
                              node.metadata.status === "success"
                                ? "#16a34a"
                                : node.metadata.status === "error"
                                  ? "#dc2626"
                                  : "#eab308",
                          }}
                        />
                      ) : null}
                    </span>
                    <span
                      className={cn(
                        "min-w-0",
                        viewMode === "grid" ? "mt-1 w-full" : "flex-1",
                      )}
                    >
                      <span className="block truncate text-xs font-medium">
                        {node.title ||
                          getNodeDefinition(node.type)?.title ||
                          t("canvas.node.untitled")}
                      </span>
                      {viewMode === "list" ? (
                        <span className="block truncate text-[11px] opacity-50">
                          {node.type === CanvasNodeType.Text
                            ? node.metadata?.content ||
                              node.metadata?.prompt ||
                              ""
                            : getNodeDefinition(node.type)?.title || node.type}
                        </span>
                      ) : null}
                    </span>
                  </button>
                  {!selecting &&
                  viewMode === "list" &&
                  (image || node.type === CanvasNodeType.Video) ? (
                    <button
                      type="button"
                      className="grid size-7 shrink-0 place-items-center rounded opacity-60 hover:bg-black/10 hover:opacity-100"
                      aria-label={t("canvas.sidePanel.preview")}
                      onClick={() => onPreviewNode(node.id)}
                    >
                      <Eye size={14} />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t("canvas.sidePanel.noNodes")}
            className="pt-12"
          />
        )}
      </div>
      {selecting ? (
        <footer
          className="flex items-center gap-2 border-t px-3 py-2"
          style={{ borderColor: theme.toolbar.border }}
        >
          <button
            type="button"
            className="text-xs opacity-70 hover:opacity-100"
            onClick={toggleVisible}
          >
            {allVisible
              ? t("canvas.sidePanel.clearAll")
              : t("workbench.selectAll")}
          </button>
          <span className="text-xs opacity-50">
            {t("canvas.sidePanel.selected", { count: checked.size })}
          </span>
          <button
            type="button"
            disabled={!checked.size || exporting}
            onClick={() => void exportSelection()}
            className="ml-auto flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-semibold hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/5"
          >
            <Download size={14} />
            {t("canvas.exportSelected")}
          </button>
        </footer>
      ) : null}
    </section>
  );
}

const AssetBrowser = memo(function AssetBrowser({
  theme,
  onInsert,
}: {
  theme: CanvasTheme;
  onInsert: (payload: InsertAssetPayload) => void;
}) {
  const { message } = App.useApp();
  const { t } = useTranslation();
  const assets = useAssetStore((state) => state.assets);
  const addAsset = useAssetStore((state) => state.addAsset);
  const removeAsset = useAssetStore((state) => state.removeAsset);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<AssetPickerKindFilter>("all");
  const [busy, setBusy] = useState(false);
  const pickerRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(
    () => filterPickerAssets(assets, kind, query),
    [assets, kind, query],
  );
  const importFiles = async (files: FileList | null) => {
    const chosen = Array.from(files || []);
    if (!chosen.length) return;
    setBusy(true);
    try {
      const results = await Promise.allSettled(
        chosen.map(async (file) => {
          if (file.type.startsWith("image/")) {
            const image = await uploadImage(file);
            addAsset({
              kind: "image",
              title: file.name,
              coverUrl: image.url,
              tags: [],
              data: {
                dataUrl: image.url,
                storageKey: image.storageKey,
                width: image.width,
                height: image.height,
                bytes: image.bytes,
                mimeType: image.mimeType,
              },
            });
            return;
          }
          if (file.type.startsWith("video/")) {
            const media = await uploadMediaFile(file, "video");
            addAsset({
              kind: "video",
              title: file.name,
              coverUrl: "",
              tags: [],
              data: {
                url: media.url,
                storageKey: media.storageKey,
                width: media.width || 0,
                height: media.height || 0,
                bytes: media.bytes,
                mimeType: media.mimeType,
              },
            });
            return;
          }
          throw new Error("unsupported media");
        }),
      );
      const failed = results.filter(
        (result) => result.status === "rejected",
      ).length;
      const added = results.length - failed;
      if (added)
        message.success(t("canvas.sidePanel.addedAssets", { count: added }));
      if (failed) message.warning(t("canvas.sidePanel.addFailed"));
      if (!added && !failed) message.warning(t("canvas.sidePanel.mediaOnly"));
    } finally {
      setBusy(false);
      if (pickerRef.current) pickerRef.current.value = "";
    }
  };

  return (
    <section className="flex h-full flex-col">
      <div className="flex gap-2 px-3 pt-3">
        <Input
          size="small"
          allowClear
          prefix={<Search size={14} />}
          placeholder={t("canvas.sidePanel.searchAssets")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => pickerRef.current?.click()}
          className="grid size-8 shrink-0 place-items-center rounded-md hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/5"
          title={t("canvas.sidePanel.add")}
          aria-label={t("canvas.sidePanel.add")}
        >
          <Plus size={16} />
        </button>
        <input
          ref={pickerRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={(event) => void importFiles(event.target.files)}
        />
      </div>
      <div className="px-3 py-2">
        <Select
          size="small"
          className="w-full"
          value={kind}
          onChange={setKind}
          options={(
            ["all", "image", "video", "text"] as AssetPickerKindFilter[]
          ).map((value) => ({
            value,
            label:
              value === "all" ? t("common.all") : t(`assets.kinds.${value}`),
          }))}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {busy ? (
          <div className="grid place-items-center py-4">
            <Spin size="small" />
          </div>
        ) : null}
        {filtered.length ? (
          <div className="space-y-1.5">
            {filtered.map((asset) => (
              <AssetRow
                key={asset.id}
                asset={asset}
                theme={theme}
                onInsert={() => onInsert(toInsertAssetPayload(asset))}
                onRemove={() => {
                  removeAsset(asset.id);
                  message.success(t("canvas.sidePanel.assetRemoved"));
                }}
              />
            ))}
          </div>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t("canvas.sidePanel.noAssets")}
            className="pt-12"
          />
        )}
      </div>
    </section>
  );
});

function AssetRow({
  asset,
  theme,
  onInsert,
  onRemove,
}: {
  asset: Asset;
  theme: CanvasTheme;
  onInsert: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="group flex min-w-0 items-center gap-2 rounded-md border p-1.5"
      style={{ borderColor: theme.node.stroke, background: theme.node.panel }}
    >
      <button
        type="button"
        onClick={onInsert}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <AssetPreview asset={asset} />
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold">
            {asset.title || t(`assets.kinds.${asset.kind}`)}
          </span>
          <span className="block text-[11px] opacity-50">
            {t(`assets.kinds.${asset.kind}`)}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="grid size-7 shrink-0 place-items-center rounded opacity-60 hover:bg-red-500/10 hover:text-red-600"
        aria-label={t("common.delete")}
        title={t("common.delete")}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function AssetPreview({ asset }: { asset: Asset }) {
  if (asset.kind === "video" && asset.data.url)
    return (
      <video
        src={`${asset.data.url}#t=0.1`}
        muted
        playsInline
        preload="metadata"
        className="size-10 shrink-0 rounded object-cover"
      />
    );
  const src =
    asset.kind === "image"
      ? previewUrlFor(asset.data.storageKey) || asset.data.dataUrl
      : assetCoverUrl(asset);
  return src ? (
    <img
      src={src}
      alt=""
      loading="lazy"
      className="size-10 shrink-0 rounded object-cover"
    />
  ) : (
    <span className="grid size-10 shrink-0 place-items-center rounded bg-black/5 dark:bg-white/5">
      <FileText size={16} />
    </span>
  );
}

const PromptBrowser = memo(function PromptBrowser({
  theme,
  onInsert,
}: {
  theme: CanvasTheme;
  onInsert: (payload: InsertAssetPayload) => void;
}) {
  const { message } = App.useApp();
  const { t } = useTranslation();
  const sources = usePromptSourceStore((state) =>
    state.sources.filter((source) => source.enabled),
  );
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [detail, setDetail] = useState<Prompt | null>(null);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success(t("canvas.sidePanel.promptCopied"));
    } catch {
      message.error(t("canvas.sidePanel.copyFailed"));
    }
  };
  return (
    <section className="flex h-full flex-col">
      <div className="px-3 pt-3">
        <Input
          size="small"
          allowClear
          prefix={<Search size={14} />}
          placeholder={t("canvas.sidePanel.searchPrompts")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {sources.length ? (
          <div className="space-y-1">
            {sources.map((source) => (
              <PromptSource
                key={source.id}
                sourceId={source.id}
                sourceName={source.name}
                query={query}
                expanded={Boolean(expanded[source.id])}
                theme={theme}
                onToggle={() =>
                  setExpanded((value) => ({
                    ...value,
                    [source.id]: !value[source.id],
                  }))
                }
                onInsert={onInsert}
                onView={setDetail}
              />
            ))}
          </div>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t("canvas.sidePanel.noPrompts")}
            className="pt-12"
          />
        )}
      </div>
      <PromptDetailDialog
        prompt={detail}
        onClose={() => setDetail(null)}
        onCopy={(prompt) => void copy(prompt)}
      />
    </section>
  );
});

function PromptSource({
  sourceId,
  sourceName,
  query,
  expanded,
  theme,
  onToggle,
  onInsert,
  onView,
}: {
  sourceId: string;
  sourceName: string;
  query: string;
  expanded: boolean;
  theme: CanvasTheme;
  onToggle: () => void;
  onInsert: (payload: InsertAssetPayload) => void;
  onView: (prompt: Prompt) => void;
}) {
  const { t } = useTranslation();
  const visible = expanded || Boolean(query.trim());
  const result = useQuery({
    queryKey: ["canvas-library-prompts", sourceId],
    queryFn: () => fetchSourcePrompts(sourceId),
    enabled: visible,
    staleTime: 60 * 60 * 1000,
  });
  const prompts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const items = result.data || [];
    return normalized
      ? items.filter((item) =>
          [item.title, item.prompt, ...item.tags]
            .join(" ")
            .toLocaleLowerCase()
            .includes(normalized),
        )
      : items;
  }, [result.data, query]);
  return (
    <div
      className="border-b pb-1"
      style={{ borderColor: theme.toolbar.border }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex min-h-9 w-full items-center gap-2 text-left text-xs font-semibold"
      >
        <ChevronRight
          size={14}
          className={cn("transition-transform", visible && "rotate-90")}
        />
        <BookOpen size={14} />
        <span className="min-w-0 flex-1 truncate">{sourceName}</span>
        {result.isSuccess ? (
          <span className="opacity-50">{prompts.length}</span>
        ) : null}
      </button>
      {visible ? (
        <div className="space-y-1 pb-2">
          {result.isLoading ? (
            <div className="grid place-items-center py-4">
              <Spin size="small" />
            </div>
          ) : result.isError ? (
            <button
              type="button"
              onClick={() => void result.refetch()}
              className="w-full py-3 text-xs text-red-600"
            >
              {t("canvas.sidePanel.loadFailedRetry")}
            </button>
          ) : prompts.length ? (
            prompts.map((prompt) => (
              <div
                key={prompt.id}
                className="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-black/5 dark:hover:bg-white/5"
              >
                {prompt.coverUrl ? (
                  <img
                    src={prompt.coverUrl}
                    alt=""
                    loading="lazy"
                    className="size-9 shrink-0 rounded object-cover"
                  />
                ) : (
                  <span
                    className="grid size-9 shrink-0 place-items-center rounded"
                    style={{ background: theme.node.panel }}
                  >
                    <FileText size={15} />
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onView(prompt)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-xs font-medium">
                    {prompt.title}
                  </span>
                  <span className="block truncate text-[11px] opacity-50">
                    {prompt.prompt}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onInsert({
                      kind: "text",
                      content: prompt.prompt,
                      title: prompt.title,
                    })
                  }
                  className="grid size-7 shrink-0 place-items-center rounded hover:bg-black/10 dark:hover:bg-white/10"
                  title={t("canvas.sidePanel.inserted")}
                  aria-label={t("canvas.sidePanel.inserted")}
                >
                  <Plus size={14} />
                </button>
              </div>
            ))
          ) : (
            <div className="py-3 text-center text-xs opacity-50">
              {query.trim()
                ? t("canvas.sidePanel.noMatchingPrompts")
                : t("canvas.sidePanel.sourceEmpty")}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
