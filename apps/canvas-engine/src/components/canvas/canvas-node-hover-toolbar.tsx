import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { App, Button, Modal, Segmented, Select } from "antd";
import {
  Download,
  Ellipsis,
  FolderPlus,
  Image as ImageIcon,
  Info,
  MessageSquare,
  Minus,
  Music2,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
  Ungroup,
  Upload,
  Video,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { formatBytes, getDataUrlByteSize } from "@/lib/image-utils";
import { useCopyText } from "@/hooks/use-copy-text";
import { useThemeStore } from "@/stores/use-theme-store";
import {
  CanvasNodeType,
  type CanvasNodeData,
  type ViewportTransform,
} from "@/types/canvas";
import type { CanvasNodeToolbarItem } from "@/types/canvas-plugin";
import {
  getPlatformInit,
  onPlatformInit,
  platformRequest,
} from "@/platform/rpc";
import type { CanvasVideoSkill } from "@/platform/skill-video";
import {
  ImageToolSettingsModal,
  type ImageToolbarSettingsTool,
} from "./canvas-image-toolbar-settings-modal";
import {
  IMAGE_QUICK_TOOLS_STORAGE_KEY,
  buildImageToolbarTools,
  defaultImageQuickToolIds,
  readImageQuickToolsConfig,
  type ImageQuickToolId,
} from "./canvas-image-toolbar-tools";

type CanvasNodeHoverToolbarProps = {
  node: CanvasNodeData | null;
  viewport: ViewportTransform;
  canvasWidth: number;
  projectId: string;
  onKeep: (nodeId: string) => void;
  onLeave: () => void;
  onInfo: (node: CanvasNodeData) => void;
  onDecreaseFont: (node: CanvasNodeData) => void;
  onIncreaseFont: (node: CanvasNodeData) => void;
  onToggleDialog: (node: CanvasNodeData) => void;
  onGenerateImage: (node: CanvasNodeData) => void;
  onPrepareVideo: (
    node: CanvasNodeData,
    skill: CanvasVideoSkill | null,
    signal: AbortSignal,
  ) => Promise<void>;
  onUpload: (node: CanvasNodeData) => void;
  onDownload: (node: CanvasNodeData) => void;
  onSaveAsset: (node: CanvasNodeData) => void;
  onMaskEdit: (node: CanvasNodeData) => void;
  onCrop: (node: CanvasNodeData) => void;
  onSplit: (node: CanvasNodeData) => void;
  onUpscale: (node: CanvasNodeData) => void;
  onSuperResolve: (node: CanvasNodeData) => void;
  onAngle: (node: CanvasNodeData) => void;
  onViewImage: (node: CanvasNodeData) => void;
  onReversePrompt: (node: CanvasNodeData) => void;
  onRetry: (node: CanvasNodeData) => void;
  onToggleFreeResize: (node: CanvasNodeData) => void;
  onDelete: (node: CanvasNodeData) => void;
  onUngroup?: (node: CanvasNodeData) => void;
  extraTools?: CanvasNodeToolbarItem[];
};

type Action = CanvasNodeToolbarItem;
type Preferences = { ids: ImageQuickToolId[]; showLabels: boolean };

function readPreferences(): Preferences {
  try {
    return readImageQuickToolsConfig(
      JSON.parse(localStorage.getItem(IMAGE_QUICK_TOOLS_STORAGE_KEY) || "null"),
    );
  } catch {
    return { ids: [...defaultImageQuickToolIds], showLabels: false };
  }
}

/** The request belongs to one node and project; changing either retires its results. */
function useVideoRecipes(node: CanvasNodeData | null, projectId: string) {
  const [scope, setScope] = useState(() => getPlatformInit()?.scopeId || "");
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<{
    skills: CanvasVideoSkill[];
    loading: boolean;
    error: string;
  }>({ skills: [], loading: false, error: "" });
  useEffect(() => onPlatformInit((init) => setScope(init.scopeId)), []);
  useEffect(() => {
    if (node?.type !== CanvasNodeType.Text) {
      setState({ skills: [], loading: false, error: "" });
      return;
    }
    const request = new AbortController();
    setState({ skills: [], loading: true, error: "" });
    void platformRequest<{ skills: CanvasVideoSkill[] }>(
      "skills.list",
      {},
      { signal: request.signal, timeoutMs: 20_000 },
    )
      .then((result) => {
        if (request.signal.aborted) return;
        const skills = (
          Array.isArray(result.skills) ? result.skills : []
        ).filter(
          (skill) =>
            skill &&
            typeof skill.id === "string" &&
            typeof skill.name === "string" &&
            typeof skill.version === "string",
        );
        setState({ skills, loading: false, error: "" });
      })
      .catch((error: unknown) => {
        if (!request.signal.aborted)
          setState({
            skills: [],
            loading: false,
            error: error instanceof Error ? error.message : "Skill 加载失败",
          });
      });
    return () => request.abort();
  }, [node?.id, node?.type, projectId, scope, refresh]);
  return { ...state, retry: () => setRefresh((value) => value + 1) };
}

/** A compact, theme-aware inspector placed next to the selected node. */
export function CanvasNodeHoverToolbar(props: CanvasNodeHoverToolbarProps) {
  const { node, viewport, canvasWidth, projectId, onKeep, onLeave } = props;
  const { t } = useTranslation();
  const { message } = App.useApp();
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const copy = useCopyText();
  const toolbar = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(96);
  const [preferences, setPreferences] = useState(readPreferences);
  const [draft, setDraft] = useState<Preferences>(preferences);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [skillOpen, setSkillOpen] = useState(false);
  const [skillId, setSkillId] = useState("");
  const [preparing, setPreparing] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const recipes = useVideoRecipes(node, projectId);

  useEffect(() => {
    setSettingsOpen(false);
    setSkillOpen(false);
    setSkillId("");
    setPreparing(false);
    return () => {
      operation.current?.abort();
      operation.current = null;
    };
  }, [node?.id, projectId]);
  useLayoutEffect(() => {
    if (!toolbar.current) return;
    const measure = () => setHeight(toolbar.current?.offsetHeight || 96);
    const observer = new ResizeObserver(measure);
    observer.observe(toolbar.current);
    measure();
    return () => observer.disconnect();
  }, [node?.id]);
  if (!node) return null;
  const target = node;
  const hasContent = Boolean(node.metadata?.content);
  const image = node.type === CanvasNodeType.Image;
  const text = node.type === CanvasNodeType.Text;
  const video = node.type === CanvasNodeType.Video;
  const audio = node.type === CanvasNodeType.Audio;
  const base: Action[] = [
    {
      id: "info",
      title: t("canvas.nodeToolbar.infoTitle"),
      label: t("canvas.nodeToolbar.info"),
      icon: <Info className="size-4" />,
      onClick: () => props.onInfo(target),
    },
  ];
  if (hasContent && (image || video || audio))
    base.push({
      id: "download",
      title: t("common.download"),
      label: t("common.download"),
      icon: <Download className="size-4" />,
      onClick: () => props.onDownload(target),
    });
  if (text || (hasContent && (image || video)))
    base.push({
      id: "saveAsset",
      title: t("common.addToAssets"),
      label: t("canvas.nodeToolbar.saveAsset"),
      icon: <FolderPlus className="size-4" />,
      onClick: () => props.onSaveAsset(target),
    });
  const editing: Action[] = [];
  if (image && hasContent)
    editing.push(
      ...buildImageToolbarTools(node, {
        ...props,
        onCopyPrompt: (item) => {
          const prompt = item.metadata?.prompt?.trim();
          if (prompt) copy(prompt, t("common.promptCopied"));
          else message.warning(t("canvas.nodeToolbar.noPrompt"));
        },
      }),
    );
  else if (image || video || audio)
    editing.push({
      id: "upload",
      title: t(
        video
          ? hasContent
            ? "canvas.nodeToolbar.replaceVideo"
            : "canvas.nodeToolbar.uploadVideo"
          : audio
            ? hasContent
              ? "canvas.nodeToolbar.replaceAudio"
              : "canvas.nodeToolbar.uploadAudio"
            : "canvas.nodeToolbar.uploadImage",
      ),
      label: t("canvas.importAsset"),
      icon: audio ? (
        <Music2 className="size-4" />
      ) : (
        <Upload className="size-4" />
      ),
      onClick: () => props.onUpload(target),
    });
  if (text)
    editing.push(
      {
        id: "generateImage",
        title: t("canvas.node.generateImage"),
        label: t("canvas.node.generate"),
        icon: <ImageIcon className="size-4" />,
        onClick: () => props.onGenerateImage(target),
      },
      {
        id: "smaller",
        title: t("canvas.nodeToolbar.decreaseFont"),
        label: t("canvas.nodeToolbar.zoomOut"),
        icon: <Minus className="size-4" />,
        onClick: () => props.onDecreaseFont(target),
      },
      {
        id: "larger",
        title: t("canvas.nodeToolbar.increaseFont"),
        label: t("canvas.nodeToolbar.zoomIn"),
        icon: <Plus className="size-4" />,
        onClick: () => props.onIncreaseFont(target),
      },
    );
  if (video || node.type === CanvasNodeType.Config)
    editing.push({
      id: "parameters",
      title: t("common.edit"),
      label: t("common.edit"),
      icon: <Settings2 className="size-4" />,
      onClick: () => props.onToggleDialog(target),
    });
  if (node.type === CanvasNodeType.Group && props.onUngroup)
    editing.push({
      id: "ungroup",
      title: t("canvas.nodeToolbar.ungroupTitle"),
      label: t("canvas.nodeToolbar.ungroup"),
      icon: <Ungroup className="size-4" />,
      onClick: () => props.onUngroup?.(target),
    });
  const removal: Action = {
    id: "delete",
    title: t("canvas.nodeToolbar.removeTitle"),
    label: t("common.delete"),
    icon: <Trash2 className="size-4" />,
    danger: true,
    onClick: () => props.onDelete(target),
  };
  const configurable = [...base, ...editing, removal];
  const selectedIds = new Set<string>(preferences.ids);
  const visible =
    image && hasContent
      ? configurable.filter((action) => selectedIds.has(action.id))
      : configurable;
  const pendingVideo =
    video && Boolean(node.metadata?.videoTaskId) && !hasContent;
  const queryable = pendingVideo && node.metadata?.status !== "loading";
  const retryable = node.metadata?.status === "error" && !pendingVideo;
  const primary: Action[] =
    retryable || queryable
      ? [
          {
            id: "retry",
            title: t(
              queryable
                ? "canvas.nodeToolbar.queryVideoTaskTitle"
                : "canvas.nodeToolbar.retryTitle",
            ),
            label: t(
              queryable
                ? "canvas.nodeToolbar.queryVideoTask"
                : "canvas.node.retry",
            ),
            icon: <RefreshCw className="size-4" />,
            onClick: () => props.onRetry(target),
          },
        ]
      : [];
  const chosenSkill = recipes.skills.find((skill) => skill.id === skillId);
  const width = Math.min(440, Math.max(120, canvasWidth - 24));
  const half = width / 2;
  const center = viewport.x + (node.position.x + node.width / 2) * viewport.k;
  const left = Math.max(12 + half, Math.min(canvasWidth - half - 12, center));
  const top = Math.max(
    12 + height,
    viewport.y + node.position.y * viewport.k - 12,
  );
  const launchVideo = async () => {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setPreparing(true);
    onKeep(target.id);
    try {
      await props.onPrepareVideo(
        target,
        chosenSkill || null,
        controller.signal,
      );
    } catch (error) {
      if (!controller.signal.aborted)
        message.error(error instanceof Error ? error.message : "视频准备失败");
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        if (!controller.signal.aborted) setPreparing(false);
      }
    }
  };
  const savePreferences = () => {
    setPreferences(draft);
    setSettingsOpen(false);
    try {
      localStorage.setItem(
        IMAGE_QUICK_TOOLS_STORAGE_KEY,
        JSON.stringify(draft),
      );
    } catch {
      message.info("已应用本次设置；浏览器未允许保存偏好");
    }
    onLeave();
  };
  return (
    <>
      <section
        ref={toolbar}
        data-node-toolbar={node.id}
        aria-label="节点操作"
        className="absolute z-[70] -translate-x-1/2 -translate-y-full rounded-xl border p-1.5 shadow-xl"
        style={{
          left,
          top,
          width,
          background: theme.toolbar.panel,
          color: theme.node.text,
          borderColor: theme.toolbar.border,
        }}
        onMouseEnter={() => onKeep(target.id)}
        onMouseLeave={() => {
          if (!settingsOpen && !skillOpen && !preparing) onLeave();
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div
          className="flex items-center gap-2 border-b px-2 pb-1.5 text-xs"
          style={{ borderColor: theme.toolbar.border }}
        >
          <span className="min-w-0 flex-1 truncate font-medium">
            {node.title || t("canvas.node.untitled")}
          </span>
          <span style={{ color: theme.node.muted }}>
            {Math.round(node.width)} × {Math.round(node.height)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-0.5 pt-1">
          {[...primary, ...visible, ...(props.extraTools || [])].map(
            (action) => (
              <NodeAction
                key={action.id}
                action={action}
                labels={image ? preferences.showLabels : true}
              />
            ),
          )}
          {image && hasContent ? (
            <NodeAction
              labels={preferences.showLabels}
              action={{
                id: "more",
                title: t("canvas.imageTools.configure"),
                label: t("canvas.imageTools.more"),
                icon: <Ellipsis className="size-4" />,
                onClick: () => {
                  setDraft({
                    ids: [...preferences.ids],
                    showLabels: preferences.showLabels,
                  });
                  setSettingsOpen(true);
                  onKeep(target.id);
                },
              }}
            />
          ) : null}
        </div>
        {text ? (
          <div
            className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-t p-1 pt-2"
            style={{ borderColor: theme.toolbar.border }}
          >
            <Select
              aria-label="使用视频 Skill"
              placeholder="选择视频 Skill"
              value={skillId}
              loading={recipes.loading}
              disabled={preparing}
              className="min-w-0"
              options={[
                { value: "", label: "不使用 Skill" },
                ...recipes.skills.map((skill) => ({
                  value: skill.id,
                  label: skill.name + (skill.installed ? "" : " · 未安装"),
                })),
              ]}
              onChange={setSkillId}
              onOpenChange={(open) => {
                setSkillOpen(open);
                if (open) onKeep(target.id);
              }}
              getPopupContainer={(trigger) =>
                trigger.parentElement || document.body
              }
            />
            <Button
              loading={preparing}
              disabled={recipes.loading || Boolean(skillId && !chosenSkill)}
              onClick={() => void launchVideo()}
              icon={<Video className="size-4" />}
            >
              {chosenSkill && !chosenSkill.installed
                ? "安装并准备视频"
                : "准备视频"}
            </Button>
            {recipes.error ? (
              <button
                type="button"
                className="col-span-2 text-left text-xs text-red-400"
                onClick={recipes.retry}
                title={recipes.error}
              >
                Skill 加载失败，点击重试
              </button>
            ) : null}
            {chosenSkill?.requiresReference ? (
              <span
                className="col-span-2 text-xs"
                style={{ color: theme.node.muted }}
              >
                准备后连接参考图片，再确认视频参数。
              </span>
            ) : null}
          </div>
        ) : null}
      </section>
      {image && hasContent ? (
        <ImageToolSettingsModal
          open={settingsOpen}
          tools={configurable as ImageToolbarSettingsTool[]}
          selectedIds={draft.ids}
          showLabels={draft.showLabels}
          onShowLabelsChange={(showLabels) =>
            setDraft((current) => ({ ...current, showLabels }))
          }
          onToggle={(id, enabled) =>
            setDraft((current) => ({
              ...current,
              ids: enabled
                ? [...new Set([...current.ids, id])]
                : current.ids.filter((value) => value !== id),
            }))
          }
          onCancel={() => {
            setSettingsOpen(false);
            onLeave();
          }}
          onSave={savePreferences}
        />
      ) : null}
    </>
  );
}

function NodeAction({ action, labels }: { action: Action; labels: boolean }) {
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  return (
    <button
      type="button"
      aria-label={action.title}
      aria-pressed={action.active || undefined}
      title={action.title}
      onClick={action.onClick}
      className="flex h-8 items-center justify-center gap-1.5 rounded-md px-2 text-xs transition hover:brightness-125 focus-visible:outline-2"
      style={{
        color: action.danger ? "#f87171" : theme.node.text,
        background: action.active ? theme.toolbar.activeBg : undefined,
      }}
    >
      {action.icon}
      {labels ? action.label : null}
    </button>
  );
}

/** Inspect persisted metadata without expanding inline binary payloads. */
export function CanvasNodeInfoModal({
  node,
  open,
  onClose,
}: {
  node: CanvasNodeData | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState("info");
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  useEffect(() => {
    if (open) setView("info");
  }, [open, node?.id]);
  const json = useMemo(
    () =>
      node
        ? JSON.stringify(
            node,
            (_key, value) =>
              typeof value === "string" &&
              /^data:(image|video|audio)\//i.test(value)
                ? "[inline media]"
                : value,
            2,
          )
        : "",
    [node],
  );
  const rows: [string, ReactNode][] = node
    ? [
        ["ID", node.id],
        [t("canvas.nodeToolbar.name"), node.title || t("canvas.node.untitled")],
        [
          t("canvas.nodeToolbar.type"),
          getNodeDefinition(node.type)?.title || node.type,
        ],
        [
          t("canvas.nodeToolbar.size"),
          `${Math.round(node.width)} × ${Math.round(node.height)}`,
        ],
        [
          t("canvas.nodeToolbar.position"),
          `${Math.round(node.position.x)}, ${Math.round(node.position.y)}`,
        ],
        [t("canvas.nodeToolbar.status"), node.metadata?.status || "idle"],
      ]
    : [];
  if (node?.metadata?.prompt)
    rows.push([t("canvas.configNode.prompt"), node.metadata.prompt]);
  if (node?.metadata?.videoTaskId)
    rows.push([t("canvas.nodeToolbar.videoTaskId"), node.metadata.videoTaskId]);
  if (node?.metadata?.images?.length)
    rows.push([
      t("canvas.nodeToolbar.imageGroup"),
      node.metadata.images.length,
    ]);
  const bytes =
    node?.metadata?.bytes ||
    (node?.metadata?.content && node.type === CanvasNodeType.Image
      ? getDataUrlByteSize(node.metadata.content)
      : 0);
  if (bytes) rows.push([t("canvas.nodeToolbar.imageSize"), formatBytes(bytes)]);
  return (
    <Modal
      open={open && Boolean(node)}
      onCancel={onClose}
      footer={null}
      title={t("canvas.nodeToolbar.nodeInfo")}
      centered
    >
      <Segmented
        className="mb-4"
        value={view}
        onChange={(value) => setView(String(value))}
        options={[
          { label: t("canvas.nodeToolbar.info"), value: "info" },
          { label: "JSON", value: "json" },
        ]}
      />
      <div
        className="thin-scrollbar max-h-[56vh] min-h-64 overflow-auto select-text text-sm"
        data-canvas-shortcuts-ignore
      >
        {view === "json" ? (
          <pre
            className="whitespace-pre-wrap break-all rounded-lg p-3 text-xs"
            style={{ background: theme.node.fill, color: theme.node.text }}
          >
            {json}
          </pre>
        ) : (
          <dl className="grid grid-cols-[90px_minmax(0,1fr)] gap-x-3 gap-y-3">
            {rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="opacity-60">{label}</dt>
                <dd className="min-w-0 whitespace-pre-wrap break-words">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {view === "info" && node?.metadata?.errorDetails ? (
          <p className="mt-4 rounded-lg border border-red-400/30 p-3 text-red-400">
            {node.metadata.errorDetails}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
