import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Download,
  Home,
  Image as ImageIcon,
  Images,
  Keyboard,
  LayoutGrid,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Puzzle,
  Redo2,
  Undo2,
  Upload,
} from "lucide-react";
import { Dropdown, Modal, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { UserStatusActions } from "@/components/layout/user-status-actions";
import { canvasThemes } from "@/lib/canvas-theme";
import { canvasShortcutCatalog } from "@/atlas-engine/ui/shortcut-catalog";
import {
  atlasPanelTabs,
  atlasTopBarMenuGroups,
  type AtlasPanelId,
  type AtlasTopBarAction,
  type AtlasTopBarIcon,
} from "@/atlas-engine/ui/top-bar-model";
import { useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@/stores/use-theme-store";

export type CanvasTopBarProps = {
  title: string;
  titleDraft: string;
  isTitleEditing: boolean;
  onTitleDraftChange: (value: string) => void;
  onStartTitleEditing: () => void;
  onFinishTitleEditing: () => void;
  onCancelTitleEditing: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onHome: () => void;
  onProjects: () => void;
  onCreateProject: () => void;
  onExportProject: () => void;
  onImportImage: () => void;
  onOpenPlugins: () => void;
  onUndo: () => void;
  onRedo: () => void;
  agentOpen: boolean;
  onToggleAgent: () => void;
};

const menuIcons: Record<AtlasTopBarIcon, LucideIcon> = {
  home: Home,
  projects: Images,
  create: Plus,
  canvas: LayoutGrid,
  assets: ImageIcon,
  prompts: BookOpen,
  import: Upload,
  export: Download,
  shortcuts: Keyboard,
};

export function CanvasTopBar(props: CanvasTopBarProps) {
  const { t } = useTranslation();
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const titleHost = useRef<HTMLDivElement>(null);
  const editing = useRef(false);
  const [shortcutDialogOpen, setShortcutDialogOpen] = useState(false);

  const panelOpen = useCanvasSidePanelStore((state) => state.panelOpen);
  const activePanel = useCanvasSidePanelStore((state) => state.activeTab);
  const togglePanel = useCanvasSidePanelStore((state) => state.togglePanel);
  const openPanel = useCanvasSidePanelStore((state) => state.openPanel);
  const setActivePanel = useCanvasSidePanelStore((state) => state.setActiveTab);
  const shortcuts = canvasShortcutCatalog(t);

  useEffect(() => {
    editing.current = props.isTitleEditing;
  }, [props.isTitleEditing]);

  const finishTitle = useCallback(() => {
    if (!editing.current) return;
    editing.current = false;
    props.onFinishTitleEditing();
  }, [props.onFinishTitleEditing]);

  const cancelTitle = useCallback(() => {
    if (!editing.current) return;
    editing.current = false;
    props.onCancelTitleEditing();
  }, [props.onCancelTitleEditing]);

  const beginTitle = useCallback(() => {
    editing.current = true;
    props.onStartTitleEditing();
  }, [props.onStartTitleEditing]);

  const selectPanel = useCallback(
    (id: AtlasPanelId) => {
      setActivePanel(id);
      if (!panelOpen) openPanel();
    },
    [openPanel, panelOpen, setActivePanel],
  );

  const invoke = useMemo<Record<AtlasTopBarAction, () => void>>(
    () => ({
      home: props.onHome,
      projects: props.onProjects,
      create: props.onCreateProject,
      "panel-canvas": () => selectPanel("canvas"),
      "panel-assets": () => selectPanel("assets"),
      "panel-prompts": () => selectPanel("prompts"),
      import: props.onImportImage,
      export: props.onExportProject,
      shortcuts: () => setShortcutDialogOpen(true),
    }),
    [
      props.onHome,
      props.onProjects,
      props.onCreateProject,
      props.onImportImage,
      props.onExportProject,
      selectPanel,
    ],
  );

  const menu = useMemo(
    () => ({
      items: atlasTopBarMenuGroups.flatMap((group, index) => [
        ...(index > 0 ? [{ type: "divider" as const }] : []),
        ...group.map((item) => {
          const Icon = menuIcons[item.icon];
          return {
            key: item.id,
            icon: <Icon size={16} aria-hidden="true" />,
            label: t(item.labelKey),
            onClick: invoke[item.action],
          };
        }),
      ]),
    }),
    [invoke, t],
  );

  return (
    <>
      <header
        className="canvas-atlas-topbar pointer-events-none absolute inset-x-0 top-0 z-50 flex items-center gap-2 px-3"
        role="toolbar"
        aria-label={t("canvas.controls.title")}
      >
        <div className="pointer-events-auto flex min-w-0 flex-1 items-center gap-2">
          <IconControl
            label={
              panelOpen ? t("canvas.collapsePanel") : t("canvas.expandPanel")
            }
            icon={panelOpen ? PanelLeftClose : PanelLeftOpen}
            color={theme.node.text}
            onClick={togglePanel}
          />
          <PanelPicker
            active={activePanel}
            theme={theme}
            onSelect={selectPanel}
          />
          <ProjectTitle
            ref={titleHost}
            title={props.title}
            draft={props.titleDraft}
            editing={props.isTitleEditing}
            color={theme.node.text}
            border={theme.toolbar.activeText}
            renameLabel={t("canvas.renameHint")}
            onChange={props.onTitleDraftChange}
            onBegin={beginTitle}
            onFinish={finishTitle}
            onCancel={cancelTitle}
          />
          <Dropdown trigger={["click"]} menu={menu}>
            <button
              type="button"
              className="grid size-8 shrink-0 place-items-center rounded-md text-current transition-colors hover:bg-black/5 dark:hover:bg-white/10"
              style={{ color: theme.node.text }}
              aria-label={t("canvas.openMenu")}
              title={t("canvas.openMenu")}
            >
              <Menu size={18} aria-hidden="true" />
            </button>
          </Dropdown>
        </div>

        <div className="pointer-events-auto flex shrink-0 items-center gap-1">
          <IconControl
            label={t("canvas.undo")}
            icon={Undo2}
            color={theme.node.text}
            disabled={!props.canUndo}
            onClick={props.onUndo}
          />
          <IconControl
            label={t("canvas.redo")}
            icon={Redo2}
            color={theme.node.text}
            disabled={!props.canRedo}
            onClick={props.onRedo}
          />
          <span
            aria-hidden="true"
            className="mx-1 h-6 w-px"
            style={{ background: theme.toolbar.border }}
          />
          <UserStatusActions
            variant="canvas"
            onOpenShortcuts={() => setShortcutDialogOpen(true)}
            onOpenPlugins={props.onOpenPlugins}
          />
          <Tooltip title={t("topNav.openAgent")}>
            <button
              type="button"
              onClick={props.onToggleAgent}
              aria-label={t("topNav.openAgent")}
              aria-pressed={props.agentOpen}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium transition-colors max-[520px]:size-8 max-[520px]:justify-center max-[520px]:px-0"
              style={{
                background: props.agentOpen
                  ? theme.toolbar.activeBg
                  : theme.toolbar.panel,
                borderColor: props.agentOpen
                  ? theme.toolbar.activeText
                  : theme.toolbar.border,
                color: props.agentOpen
                  ? theme.toolbar.activeText
                  : theme.node.text,
              }}
            >
              <Puzzle size={16} aria-hidden="true" />
              <span className="max-[520px]:sr-only">
                {t("topNav.openAgent")}
              </span>
            </button>
          </Tooltip>
        </div>
      </header>

      <Modal
        title={t("canvas.shortcuts")}
        open={shortcutDialogOpen}
        onCancel={() => setShortcutDialogOpen(false)}
        footer={null}
        centered
      >
        <dl
          className="thin-scrollbar m-0 grid max-h-[min(65dvh,640px)] gap-1 overflow-y-auto border-t pt-3 text-sm"
          style={{ borderColor: theme.node.stroke }}
        >
          {shortcuts.map((shortcut) => (
            <ShortcutRow
              key={shortcut.id}
              keys={shortcut.keys}
              description={shortcut.description}
            />
          ))}
        </dl>
      </Modal>
    </>
  );
}

function PanelPicker({
  active,
  theme,
  onSelect,
}: {
  active: AtlasPanelId;
  theme: (typeof canvasThemes)[keyof typeof canvasThemes];
  onSelect: (panel: AtlasPanelId) => void;
}) {
  const { t } = useTranslation();
  return (
    <nav
      className="hidden shrink-0 items-center gap-0.5 rounded-lg border p-1 min-[481px]:flex"
      style={{
        background: theme.toolbar.panel,
        borderColor: theme.toolbar.border,
      }}
      aria-label={t("canvas.controls.title")}
    >
      {atlasPanelTabs.map((panel) => {
        const Icon = menuIcons[panel.icon];
        const selected = active === panel.id;
        const label = t(panel.labelKey);
        return (
          <Tooltip key={panel.id} title={label}>
            <button
              type="button"
              onClick={() => onSelect(panel.id)}
              aria-label={label}
              aria-pressed={selected}
              className="grid size-7 shrink-0 place-items-center rounded-md transition-colors"
              style={{
                background: selected ? theme.toolbar.activeBg : undefined,
                color: selected ? theme.toolbar.activeText : theme.toolbar.item,
              }}
            >
              <Icon size={16} aria-hidden="true" />
            </button>
          </Tooltip>
        );
      })}
    </nav>
  );
}

function ProjectTitle({
  ref,
  title,
  draft,
  editing,
  color,
  border,
  renameLabel,
  onChange,
  onBegin,
  onFinish,
  onCancel,
}: {
  ref: React.RefObject<HTMLDivElement | null>;
  title: string;
  draft: string;
  editing: boolean;
  color: string;
  border: string;
  renameLabel: string;
  onChange: (value: string) => void;
  onBegin: () => void;
  onFinish: () => void;
  onCancel: () => void;
}) {
  return (
    <div ref={ref} className="flex min-w-0 flex-1 items-center pl-1">
      {editing ? (
        <input
          autoFocus
          value={draft}
          maxLength={200}
          aria-label={renameLabel}
          className="w-full min-w-0 max-w-[360px] border-b bg-transparent px-0 py-1 text-sm font-semibold outline-none"
          style={{ color, borderColor: border }}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onFinish}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onFinish();
            } else if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
        />
      ) : (
        <button
          type="button"
          onDoubleClick={onBegin}
          onKeyDown={(event) => {
            if (event.key === "F2" || event.key === "Enter") {
              event.preventDefault();
              onBegin();
            }
          }}
          className="block w-full min-w-0 max-w-[360px] truncate border-b border-transparent py-1 text-left text-sm font-semibold transition-colors hover:border-current"
          style={{ color }}
          title={`${title} · ${renameLabel}`}
        >
          {title}
        </button>
      )}
    </div>
  );
}

function IconControl({
  label,
  icon: Icon,
  color,
  disabled = false,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  color: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip title={label}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className="grid size-8 shrink-0 place-items-center rounded-md text-current transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-35 dark:hover:bg-white/10"
        style={{ color }}
      >
        <Icon size={17} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

function ShortcutRow({
  keys,
  description,
}: {
  keys: string[];
  description: string;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-6 rounded-md px-1 py-1.5">
      <dt className="m-0 flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="sr-only">{keys.join(" plus ")}</span>
        <span
          aria-hidden="true"
          className="flex flex-wrap items-center gap-1.5"
        >
          {keys.map((key, index) => (
            <span key={`${key}-${index}`} className="flex items-center gap-1.5">
              {index > 0 ? <span className="text-xs opacity-35">+</span> : null}
              <kbd className="min-w-9 rounded border border-stone-300 bg-stone-50 px-2.5 py-1.5 text-center text-xs font-medium leading-none text-stone-700 shadow-sm dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100">
                {key}
              </kbd>
            </span>
          ))}
        </span>
      </dt>
      <dd className="m-0 text-right text-sm opacity-60">{description}</dd>
    </div>
  );
}
