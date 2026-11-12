import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  BookOpen,
  Home,
  Images,
  Image as ImageIcon,
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
import { Button, Dropdown, Modal, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { UserStatusActions } from "@/components/layout/user-status-actions";
import { canvasThemes } from "@/lib/canvas-theme";
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
  compactAgentStatus: {
    connected: boolean;
    enabled: boolean;
    activity: string;
  };
  onToggleAgent: () => void;
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
  const { t } = useTranslation();
  const theme = canvasThemes[colorTheme];
  const titleRef = useRef<HTMLDivElement>(null);
  const editSessionActive = useRef(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const sidePanelOpen = useCanvasSidePanelStore((state) => state.panelOpen);
  const toggleSidePanel = useCanvasSidePanelStore((state) => state.togglePanel);
  const activeSidePanelTab = useCanvasSidePanelStore((state) => state.activeTab);
  const setActiveSidePanelTab = useCanvasSidePanelStore((state) => state.setActiveTab);
  const openSidePanel = useCanvasSidePanelStore((state) => state.openPanel);
  const sidePanelTabs = [
    { id: "canvas", icon: LayoutGrid, label: t("canvas.sidePanel.canvas") },
    { id: "assets", icon: ImageIcon, label: t("canvas.sidePanel.assets") },
    { id: "prompts", icon: BookOpen, label: t("canvas.sidePanel.prompts") },
  ] as const;

  useEffect(() => {
    editSessionActive.current = isTitleEditing;
  }, [isTitleEditing]);

  const finishTitleEditingOnce = useCallback(() => {
    if (!editSessionActive.current) return;
    editSessionActive.current = false;
    onFinishTitleEditing();
  }, [onFinishTitleEditing]);

  const cancelTitleEditingOnce = useCallback(() => {
    if (!editSessionActive.current) return;
    editSessionActive.current = false;
    onCancelTitleEditing();
  }, [onCancelTitleEditing]);

  const startTitleEditing = useCallback(() => {
    editSessionActive.current = true;
    onStartTitleEditing();
  }, [onStartTitleEditing]);

  useEffect(() => {
    if (!isTitleEditing) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!titleRef.current?.contains(event.target as Node))
        finishTitleEditingOnce();
    };
    document.addEventListener("pointerdown", closeOnOutsidePress, true);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePress, true);
  }, [finishTitleEditingOnce, isTitleEditing]);

  const menuItems = [
    {
      key: "projects",
      icon: <Images className="size-4" />,
      label: t("canvas.projects"),
      onClick: onProjects,
    },
    {
      key: "create",
      icon: <Plus className="size-4" />,
      label: t("canvas.create"),
      onClick: onCreateProject,
    },
    { type: "divider" as const },
    {
      key: "import",
      icon: <Upload className="size-4" />,
      label: t("canvas.importAsset"),
      onClick: onImportImage,
    },
    {
      key: "export",
      icon: <Download className="size-4" />,
      label: t("canvas.exportCurrent"),
      onClick: onExportProject,
    },
  ];

  return (
    <>
      <div className="canvas-atlas-topbar pointer-events-none absolute left-0 right-0 top-0 z-50 flex h-16 items-center justify-between gap-2 pl-1 pr-3 max-[520px]:gap-1 max-[520px]:pr-2">
        <div className="pointer-events-auto flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          <Tooltip
            title={
              sidePanelOpen
                ? t("canvas.collapsePanel")
                : t("canvas.expandPanel")
            }
          >
            <button
              type="button"
              onClick={toggleSidePanel}
              aria-label={
                sidePanelOpen
                  ? t("canvas.collapsePanel")
                  : t("canvas.expandPanel")
              }
              className="grid size-8 shrink-0 place-items-center rounded-lg transition hover:bg-white/10"
              style={{ color: theme.node.text }}
            >
              {sidePanelOpen ? (
                <PanelLeftClose className="size-4" />
              ) : (
                <PanelLeftOpen className="size-4" />
              )}
            </button>
          </Tooltip>
          <div
            className="pointer-events-auto flex shrink-0 items-center gap-0.5 rounded-lg border p-0.5"
            style={{
              background: theme.toolbar.panel,
              borderColor: theme.toolbar.border,
            }}
            role="group"
            aria-label={t("canvas.sidePanel.canvas")}
          >
            {sidePanelTabs.map(({ id, icon: Icon, label }) => {
              const active = activeSidePanelTab === id;
              return (
                <Tooltip key={id} title={label}>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveSidePanelTab(id);
                      if (!sidePanelOpen) openSidePanel();
                    }}
                    aria-label={label}
                    aria-pressed={active}
                    className="grid size-8 shrink-0 place-items-center rounded-md transition max-[520px]:size-7"
                    style={{
                      background: active ? theme.toolbar.activeBg : undefined,
                      color: active ? theme.toolbar.activeText : theme.toolbar.item,
                    }}
                  >
                    <Icon className="size-4 max-[520px]:size-3.5" aria-hidden="true" />
                  </button>
                </Tooltip>
              );
            })}
          </div>
          <Tooltip title={t("canvas.home")}>
            <button
              type="button"
              onClick={onHome}
              aria-label={t("canvas.home")}
              className="grid size-8 shrink-0 place-items-center rounded-lg transition hover:bg-white/10"
              style={{ color: theme.node.text }}
            >
              <Home className="size-4" />
            </button>
          </Tooltip>
          <Dropdown trigger={["click"]} menu={{ items: menuItems }}>
            <button
              type="button"
              className="grid size-8 shrink-0 place-items-center rounded-lg transition hover:bg-white/10"
              style={{ color: theme.node.text }}
              aria-label={t("canvas.openMenu")}
              title={t("canvas.openMenu")}
            >
              <Menu className="size-4" />
            </button>
          </Dropdown>

          <div
            ref={titleRef}
            className="flex min-w-0 flex-1 items-center gap-2 pl-1"
          >
            {isTitleEditing ? (
              <input
                autoFocus
                value={titleDraft}
                maxLength={200}
                aria-label={t("canvas.renameHint")}
                onChange={(event) => onTitleDraftChange(event.target.value)}
                onBlur={finishTitleEditingOnce}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    finishTitleEditingOnce();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelTitleEditingOnce();
                  }
                }}
                className="w-full min-w-0 max-w-[320px] border-b border-white/25 bg-transparent px-0 py-1 text-left text-base font-semibold outline-none transition focus:border-[var(--atlas-accent)] max-[520px]:text-sm"
                style={{ color: theme.node.text }}
              />
            ) : (
              <button
                type="button"
                className="block w-full min-w-0 max-w-[320px] truncate border-b border-dashed border-transparent py-1 text-left text-base font-semibold transition hover:border-current max-[520px]:text-sm"
                onDoubleClick={startTitleEditing}
                onKeyDown={(event) => {
                  if (event.key === "F2" || event.key === "Enter") {
                    event.preventDefault();
                    startTitleEditing();
                  }
                }}
                title={`${title} · ${t("canvas.renameHint")}`}
              >
                {title}
              </button>
            )}
          </div>
        </div>

        <div className="pointer-events-auto flex shrink-0 items-center gap-1 max-[520px]:gap-0.5">
          <Tooltip title={t("canvas.undo")}>
            <button
              type="button"
              disabled={!canUndo}
              onClick={onUndo}
              aria-label={t("canvas.undo")}
              className="grid size-8 place-items-center rounded-lg transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
              style={{ color: theme.node.text }}
            >
              <Undo2 className="size-4" />
            </button>
          </Tooltip>
          <Tooltip title={t("canvas.redo")}>
            <button
              type="button"
              disabled={!canRedo}
              onClick={onRedo}
              aria-label={t("canvas.redo")}
              className="grid size-8 place-items-center rounded-lg transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
              style={{ color: theme.node.text }}
            >
              <Redo2 className="size-4" />
            </button>
          </Tooltip>
          <span
            className="mx-1 h-6 w-px"
            style={{ background: theme.toolbar.border }}
          />
          <UserStatusActions
            variant="canvas"
            onOpenShortcuts={() => setShortcutsOpen(true)}
            onOpenPlugins={onOpenPlugins}
          />
          <Button
            type="text"
            className="!h-9 !shrink-0 !rounded-lg !px-2.5 !font-medium max-[520px]:!w-8 max-[520px]:!px-0"
            style={{
              background: agentOpen
                ? theme.toolbar.activeBg
                : theme.toolbar.panel,
              color: theme.node.text,
              boxShadow: "0 10px 30px rgba(28,25,23,.10)",
            }}
            icon={<Puzzle className="size-4" />}
            onClick={onToggleAgent}
            aria-label={t("topNav.openAgent")}
            aria-pressed={agentOpen}
            title={t("topNav.openAgent")}
          >
            <span className="max-[520px]:hidden">{t("topNav.openAgent")}</span>
          </Button>
        </div>
      </div>
      <Modal
        title={t("canvas.shortcuts")}
        open={shortcutsOpen}
        onCancel={() => setShortcutsOpen(false)}
        footer={null}
        centered
      >
        <div
          className="space-y-2 border-t pt-4 text-sm"
          style={{ borderColor: theme.node.stroke }}
        >
          <Shortcut
            keys={[t("canvas.shortcut.dragCanvas")]}
            value={t("canvas.shortcut.pan")}
          />
          <Shortcut
            keys={[t("canvas.shortcut.wheel")]}
            value={t("canvas.shortcut.zoom")}
          />
          <Shortcut
            keys={[t("canvas.shortcut.zoomSlider")]}
            value={t("canvas.shortcut.preciseZoom")}
          />
          <Shortcut
            keys={["Shift", t("canvas.shortcut.drag")]}
            value={t("canvas.shortcut.boxSelect")}
          />
          <Shortcut
            keys={["Shift / Ctrl / Cmd", t("canvas.shortcut.click")]}
            value={t("canvas.shortcut.addSelection")}
          />
          <Shortcut
            keys={["Ctrl / Cmd", "A"]}
            value={t("canvas.shortcut.selectAll")}
          />
          <Shortcut
            keys={["Ctrl / Cmd", "C / V"]}
            value={t("canvas.shortcut.copyPaste")}
          />
          <Shortcut
            keys={["Ctrl / Cmd", "G"]}
            value={t("canvas.shortcut.group")}
          />
          <Shortcut
            keys={["Ctrl / Cmd", "Shift", "G"]}
            value={t("canvas.shortcut.ungroup")}
          />
          <Shortcut keys={["Ctrl / Cmd", "Z"]} value={t("canvas.undo")} />
          <Shortcut
            keys={["Ctrl / Cmd", "Shift", "Z"]}
            value={t("canvas.redo")}
          />
          <Shortcut keys={["Ctrl / Cmd", "Y"]} value={t("canvas.redo")} />
          <Shortcut
            keys={["Delete / Backspace"]}
            value={t("canvas.shortcut.delete")}
          />
          <Shortcut keys={["Esc"]} value={t("canvas.shortcut.escape")} />
          <Shortcut
            keys={[t("canvas.shortcut.dropMedia")]}
            value={t("canvas.shortcut.upload")}
          />
        </div>
      </Modal>
    </>
  );
}

function Shortcut({ keys, value }: { keys: string[]; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-6 rounded-lg px-1 py-1.5">
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        {keys.map((key, index) => (
          <span key={`${key}-${index}`} className="flex items-center gap-1.5">
            {index ? <span className="text-xs opacity-35">+</span> : null}
            <kbd
              className="min-w-9 rounded-md border px-2.5 py-1.5 text-center text-xs font-medium leading-none shadow-[inset_0_-1px_0_rgba(0,0,0,.08),0_1px_2px_rgba(0,0,0,.06)]"
              style={{
                borderColor: "rgba(120,113,108,.28)",
                background: "linear-gradient(#fff, rgba(245,245,244,.92))",
                color: "rgb(68,64,60)",
              }}
            >
              {key}
            </kbd>
          </span>
        ))}
      </span>
      <span className="text-right text-sm opacity-55">{value}</span>
    </div>
  );
}
