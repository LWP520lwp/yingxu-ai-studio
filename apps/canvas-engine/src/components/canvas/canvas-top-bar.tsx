import { useCallback, useEffect, useRef, useState } from "react";
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
  type LucideIcon,
} from "lucide-react";
import { Dropdown, Modal, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { UserStatusActions } from "@/components/layout/user-status-actions";
import { canvasThemes } from "@/lib/canvas-theme";
import { canvasShortcutCatalog } from "@/lib/canvas/canvas-shortcut-catalog";
import {
  canvasTopBarMenuGroups,
  canvasTopBarPanelTabs,
  type CanvasTopBarCommand,
  type CanvasTopBarIcon,
  type CanvasTopBarPanel,
} from "@/product-engine/canvas-top-bar-model";
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

const topBarIcons: Record<CanvasTopBarIcon, LucideIcon> = {
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

export function CanvasTopBar({
  title,
  titleDraft,
  isTitleEditing,
  onTitleDraftChange,
  onStartTitleEditing,
  onFinishTitleEditing,
  onCancelTitleEditing,
  canUndo,
  canRedo,
  onHome,
  onProjects,
  onCreateProject,
  onExportProject,
  onImportImage,
  onOpenPlugins,
  onUndo,
  onRedo,
  agentOpen,
  onToggleAgent,
}: CanvasTopBarProps) {
  const colorTheme = useThemeStore((state) => state.theme);
  const theme = canvasThemes[colorTheme];
  const { t } = useTranslation();
  const titleRegion = useRef<HTMLDivElement>(null);
  const editSessionActive = useRef(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const sidePanelOpen = useCanvasSidePanelStore((state) => state.panelOpen);
  const toggleSidePanel = useCanvasSidePanelStore((state) => state.togglePanel);
  const activeSidePanelTab = useCanvasSidePanelStore(
    (state) => state.activeTab,
  );
  const setActiveSidePanelTab = useCanvasSidePanelStore(
    (state) => state.setActiveTab,
  );
  const openSidePanel = useCanvasSidePanelStore((state) => state.openPanel);
  const shortcuts = canvasShortcutCatalog(t);

  const runMenuCommand: Record<CanvasTopBarCommand, () => void> = {
    home: onHome,
    projects: onProjects,
    create: onCreateProject,
    "panel-canvas": () => selectPanel("canvas"),
    "panel-assets": () => selectPanel("assets"),
    "panel-prompts": () => selectPanel("prompts"),
    import: onImportImage,
    export: onExportProject,
    shortcuts: () => setShortcutsOpen(true),
  };

  useEffect(() => {
    editSessionActive.current = isTitleEditing;
  }, [isTitleEditing]);

  const finishTitleEditing = useCallback(() => {
    if (!editSessionActive.current) return;
    editSessionActive.current = false;
    onFinishTitleEditing();
  }, [onFinishTitleEditing]);

  const cancelTitleEditing = useCallback(() => {
    if (!editSessionActive.current) return;
    editSessionActive.current = false;
    onCancelTitleEditing();
  }, [onCancelTitleEditing]);

  const beginTitleEditing = useCallback(() => {
    editSessionActive.current = true;
    onStartTitleEditing();
  }, [onStartTitleEditing]);

  useEffect(() => {
    if (!isTitleEditing) return;

    const finishWhenFocusLeaves = (event: PointerEvent) => {
      if (!titleRegion.current?.contains(event.target as Node)) {
        finishTitleEditing();
      }
    };

    document.addEventListener("pointerdown", finishWhenFocusLeaves, true);
    return () =>
      document.removeEventListener("pointerdown", finishWhenFocusLeaves, true);
  }, [finishTitleEditing, isTitleEditing]);

  const selectPanel = (tab: CanvasTopBarPanel) => {
    setActiveSidePanelTab(tab);
    if (!sidePanelOpen) openSidePanel();
  };

  const fileAndNavigationMenu = {
    items: canvasTopBarMenuGroups.flatMap((group, groupIndex) => [
      ...(groupIndex ? [{ type: "divider" as const }] : []),
      ...group.map(({ id, icon, labelKey, command }) => {
        const Icon = topBarIcons[icon];
        return {
          key: id,
          icon: <Icon size={16} />,
          label: t(labelKey),
          onClick: runMenuCommand[command],
        };
      }),
    ]),
  };

  return (
    <>
      <header
        className="canvas-atlas-topbar pointer-events-none absolute inset-x-0 top-0 z-50 flex h-14 items-center gap-3 px-3"
        role="toolbar"
        aria-label={t("canvas.controls.title")}
      >
        <div className="pointer-events-auto flex min-w-0 flex-1 items-center gap-2">
          <TopBarAction
            label={
              sidePanelOpen
                ? t("canvas.collapsePanel")
                : t("canvas.expandPanel")
            }
            icon={sidePanelOpen ? PanelLeftClose : PanelLeftOpen}
            color={theme.node.text}
            onClick={toggleSidePanel}
          />

          <div
            role="group"
            aria-label={t("canvas.controls.title")}
            className="hidden shrink-0 items-center gap-0.5 rounded-xl border p-1 min-[481px]:flex"
            style={{
              background: theme.toolbar.panel,
              borderColor: theme.toolbar.border,
            }}
          >
            {canvasTopBarPanelTabs.map(({ id, icon, labelKey }) => {
              const Icon = topBarIcons[icon];
              const selected = activeSidePanelTab === id;
              const label = t(labelKey);
              return (
                <Tooltip key={id} title={label}>
                  <button
                    type="button"
                    onClick={() => selectPanel(id)}
                    aria-label={label}
                    aria-pressed={selected}
                    className="grid size-7 shrink-0 place-items-center rounded-lg transition-colors"
                    style={{
                      background: selected ? theme.toolbar.activeBg : undefined,
                      color: selected
                        ? theme.toolbar.activeText
                        : theme.toolbar.item,
                    }}
                  >
                    <Icon size={16} aria-hidden="true" />
                  </button>
                </Tooltip>
              );
            })}
          </div>

          <div
            ref={titleRegion}
            className="flex min-w-0 flex-1 items-center pl-1"
          >
            {isTitleEditing ? (
              <input
                autoFocus
                value={titleDraft}
                maxLength={200}
                aria-label={t("canvas.renameHint")}
                onChange={(event) => onTitleDraftChange(event.target.value)}
                onBlur={finishTitleEditing}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    finishTitleEditing();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    cancelTitleEditing();
                  }
                }}
                className="w-full min-w-0 max-w-[360px] border-b bg-transparent px-0 py-1 text-left text-sm font-semibold outline-none"
                style={{
                  color: theme.node.text,
                  borderColor: theme.toolbar.activeText,
                }}
              />
            ) : (
              <button
                type="button"
                onDoubleClick={beginTitleEditing}
                onKeyDown={(event) => {
                  if (event.key === "F2" || event.key === "Enter") {
                    event.preventDefault();
                    beginTitleEditing();
                  }
                }}
                className="block w-full min-w-0 max-w-[360px] truncate border-b border-transparent py-1 text-left text-sm font-semibold transition-colors hover:border-current"
                style={{ color: theme.node.text }}
                title={`${title} · ${t("canvas.renameHint")}`}
              >
                {title}
              </button>
            )}
          </div>

          <Dropdown trigger={["click"]} menu={fileAndNavigationMenu}>
            <button
              type="button"
              className="grid size-8 shrink-0 place-items-center rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/10"
              style={{ color: theme.node.text }}
              aria-label={t("canvas.openMenu")}
              title={t("canvas.openMenu")}
            >
              <Menu size={18} aria-hidden="true" />
            </button>
          </Dropdown>
        </div>

        <div className="pointer-events-auto flex shrink-0 items-center gap-1">
          <TopBarAction
            label={t("canvas.undo")}
            icon={Undo2}
            color={theme.node.text}
            disabled={!canUndo}
            onClick={onUndo}
          />
          <TopBarAction
            label={t("canvas.redo")}
            icon={Redo2}
            color={theme.node.text}
            disabled={!canRedo}
            onClick={onRedo}
          />
          <span
            aria-hidden="true"
            className="mx-1 h-6 w-px"
            style={{ background: theme.toolbar.border }}
          />
          <UserStatusActions
            variant="canvas"
            onOpenShortcuts={() => setShortcutsOpen(true)}
            onOpenPlugins={onOpenPlugins}
          />
          <Tooltip title={t("topNav.openAgent")}>
            <button
              type="button"
              onClick={onToggleAgent}
              aria-label={t("topNav.openAgent")}
              aria-pressed={agentOpen}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium transition-colors max-[520px]:size-8 max-[520px]:justify-center max-[520px]:px-0"
              style={{
                background: agentOpen
                  ? theme.toolbar.activeBg
                  : theme.toolbar.panel,
                borderColor: agentOpen
                  ? theme.toolbar.activeText
                  : theme.toolbar.border,
                color: agentOpen ? theme.toolbar.activeText : theme.node.text,
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
        open={shortcutsOpen}
        onCancel={() => setShortcutsOpen(false)}
        footer={null}
        centered
      >
        <dl
          className="thin-scrollbar m-0 max-h-[min(65dvh,640px)] space-y-1 overflow-y-auto border-t pt-3 text-sm"
          style={{ borderColor: theme.node.stroke }}
        >
          {shortcuts.map((shortcut) => (
            <Shortcut
              key={shortcut.id}
              keys={shortcut.keys}
              value={shortcut.description}
            />
          ))}
        </dl>
      </Modal>
    </>
  );
}

function TopBarAction({
  label,
  icon: Icon,
  color,
  onClick,
  disabled = false,
}: {
  label: string;
  icon: LucideIcon;
  color: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip title={label}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className="grid size-8 shrink-0 place-items-center rounded-lg transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-35 dark:hover:bg-white/10"
        style={{ color }}
      >
        <Icon size={17} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

function Shortcut({ keys, value }: { keys: string[]; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-6 rounded-lg px-1 py-1.5">
      <dt className="m-0 flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="sr-only">{keys.join(" plus ")}</span>
        <span
          aria-hidden="true"
          className="flex flex-wrap items-center gap-1.5"
        >
          {keys.map((key, index) => (
            <span key={`${key}-${index}`} className="flex items-center gap-1.5">
              {index ? <span className="text-xs opacity-35">+</span> : null}
              <kbd className="min-w-9 rounded-md border border-stone-300 bg-stone-50 px-2.5 py-1.5 text-center text-xs font-medium leading-none text-stone-700 shadow-sm dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100">
                {key}
              </kbd>
            </span>
          ))}
        </span>
      </dt>
      <dd className="m-0 text-right text-sm opacity-60">{value}</dd>
    </div>
  );
}
