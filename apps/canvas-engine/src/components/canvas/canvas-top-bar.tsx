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

type PanelTab = "canvas" | "assets" | "prompts";

const panelTabs: { id: PanelTab; icon: LucideIcon; labelKey: string }[] = [
  { id: "canvas", icon: LayoutGrid, labelKey: "canvas.sidePanel.canvas" },
  { id: "assets", icon: ImageIcon, labelKey: "canvas.sidePanel.assets" },
  { id: "prompts", icon: BookOpen, labelKey: "canvas.sidePanel.prompts" },
];

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
  const activeSidePanelTab = useCanvasSidePanelStore((state) => state.activeTab);
  const setActiveSidePanelTab = useCanvasSidePanelStore(
    (state) => state.setActiveTab,
  );
  const openSidePanel = useCanvasSidePanelStore((state) => state.openPanel);
  const shortcuts = canvasShortcutCatalog(t);

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

  const selectPanel = (tab: PanelTab) => {
    setActiveSidePanelTab(tab);
    if (!sidePanelOpen) openSidePanel();
  };

  const fileAndNavigationMenu = {
    items: [
      { key: "home", icon: <Home size={16} />, label: t("canvas.home"), onClick: onHome },
      { key: "projects", icon: <Images size={16} />, label: t("canvas.projects"), onClick: onProjects },
      { key: "create", icon: <Plus size={16} />, label: t("canvas.create"), onClick: onCreateProject },
      { type: "divider" as const },
      ...panelTabs.map(({ id, icon: Icon, labelKey }) => ({
        key: `panel-${id}`,
        icon: <Icon size={16} />,
        label: t(labelKey),
        onClick: () => selectPanel(id),
      })),
      { type: "divider" as const },
      { key: "import", icon: <Upload size={16} />, label: t("canvas.importAsset"), onClick: onImportImage },
      { key: "export", icon: <Download size={16} />, label: t("canvas.exportCurrent"), onClick: onExportProject },
      { key: "shortcuts", icon: <Keyboard size={16} />, label: t("canvas.shortcuts"), onClick: () => setShortcutsOpen(true) },
    ],
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
            label={sidePanelOpen ? t("canvas.collapsePanel") : t("canvas.expandPanel")}
            icon={sidePanelOpen ? PanelLeftClose : PanelLeftOpen}
            color={theme.node.text}
            onClick={toggleSidePanel}
          />

          <div
            role="group"
            aria-label={t("canvas.controls.title")}
            className="hidden shrink-0 items-center gap-0.5 rounded-xl border p-1 min-[481px]:flex"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }}
          >
            {panelTabs.map(({ id, icon: Icon, labelKey }) => {
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
                      color: selected ? theme.toolbar.activeText : theme.toolbar.item,
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
                style={{ color: theme.node.text, borderColor: theme.toolbar.activeText }}
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
                background: agentOpen ? theme.toolbar.activeBg : theme.toolbar.panel,
                borderColor: agentOpen ? theme.toolbar.activeText : theme.toolbar.border,
                color: agentOpen ? theme.toolbar.activeText : theme.node.text,
              }}
            >
              <Puzzle size={16} aria-hidden="true" />
              <span className="max-[520px]:sr-only">{t("topNav.openAgent")}</span>
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
        <div
          className="thin-scrollbar max-h-[min(65dvh,640px)] space-y-1 overflow-y-auto border-t pt-3 text-sm"
          style={{ borderColor: theme.node.stroke }}
        >
          {shortcuts.map((shortcut) => (
            <Shortcut
              key={shortcut.id}
              keys={shortcut.keys}
              value={shortcut.description}
            />
          ))}
        </div>
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
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        {keys.map((key, index) => (
          <span key={`${key}-${index}`} className="flex items-center gap-1.5">
            {index ? <span className="text-xs opacity-35">+</span> : null}
            <kbd className="min-w-9 rounded-md border border-stone-300 bg-stone-50 px-2.5 py-1.5 text-center text-xs font-medium leading-none text-stone-700 shadow-sm dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100">
              {key}
            </kbd>
          </span>
        ))}
      </span>
      <span className="text-right text-sm opacity-60">{value}</span>
    </div>
  );
}
