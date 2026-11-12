import type { MouseEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Switch } from "antd";
import {
  CircleDot,
  Eraser,
  Grid2x2,
  Group,
  Hand,
  Image as ImageIcon,
  Info,
  LayoutGrid,
  LocateFixed,
  Moon,
  Music2,
  Palette,
  Puzzle,
  Redo2,
  Settings2,
  Square,
  Sun,
  Trash2,
  Type,
  Undo2,
  Upload,
  Video,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { CanvasWorkflowAuditAction } from "@/components/canvas/canvas-workflow-audit-action";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { getNodeSpec } from "@/constant/canvas";
import {
  getNodePluginId,
  listNodeDefinitions,
  useNodeRegistryVersion,
} from "@/lib/canvas/node-registry";
import {
  canvasThemes,
  type CanvasBackgroundMode,
  type CanvasColorTheme,
  type CanvasTheme,
} from "@/lib/canvas-theme";
import {
  canvasToolbarSections,
  toggleCanvasTool,
  type CanvasToolbarCommand,
} from "@/lib/canvas/canvas-toolbar-model";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

type CanvasToolbarProps = {
  selectedCount: number;
  canvasTool: "select" | "pan";
  canUndo: boolean;
  canRedo: boolean;
  backgroundMode: CanvasBackgroundMode;
  showImageInfo: boolean;
  onAddImage: () => void;
  onAddVideo: () => void;
  onAddAudio: () => void;
  onAddText: () => void;
  onAddConfig: () => void;
  onAddGroup: () => void;
  onAddExtensionNode: (type: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onUpload: () => void;
  onDelete: () => void;
  onClear: () => void;
  onCanvasToolChange: (tool: "select" | "pan") => void;
  onBackgroundModeChange: (mode: CanvasBackgroundMode) => void;
  onShowImageInfoChange: (show: boolean) => void;
  onFocusSelected: () => void;
  onTidyLayout: () => void;
  nodes: CanvasNodeData[];
  connections: CanvasConnection[];
  onFocusNode: (nodeId: string) => void;
  onRepairConnections: (connections: CanvasConnection[]) => void;
};

type MenuName = "extensions" | "appearance";

const actionIcons: Record<Exclude<CanvasToolbarCommand, "audit">, LucideIcon> = {
  pan: Hand,
  undo: Undo2,
  redo: Redo2,
  focus: LocateFixed,
  tidy: LayoutGrid,
  text: Type,
  image: ImageIcon,
  video: Video,
  audio: Music2,
  config: Settings2,
  group: Group,
  extensions: Puzzle,
  upload: Upload,
  appearance: Palette,
  delete: Trash2,
  clear: Eraser,
};

export function CanvasToolbar(props: CanvasToolbarProps) {
  const { t } = useTranslation();
  const barRef = useRef<HTMLDivElement>(null);
  const [openMenu, setOpenMenu] = useState<MenuName | null>(null);
  const [menuCenter, setMenuCenter] = useState<number | null>(null);
  const themeKey = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const colors = canvasThemes[themeKey];
  const registryVersion = useNodeRegistryVersion((state) => state.version);

  const extensionNodes = useMemo(
    () =>
      listNodeDefinitions().filter(
        (item) =>
          item.showInCreateMenu !== false &&
          getNodePluginId(item.type) !== "builtin",
      ),
    [registryVersion],
  );

  const groups = canvasToolbarSections({
    canUndo: props.canUndo,
    canRedo: props.canRedo,
    extensionCount: extensionNodes.length,
    selectedCount: props.selectedCount,
  });

  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!barRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenu]);

  const labels: Record<CanvasToolbarCommand, string> = {
    pan: t("canvas.toolbar.pan"),
    undo: t("canvas.undo"),
    redo: t("canvas.redo"),
    focus: t("canvas.toolbar.focus"),
    tidy: t("canvas.toolbar.tidy"),
    audit: t("canvas.toolbar.audit"),
    text: t("canvas.toolbar.text"),
    image: t("canvas.toolbar.image"),
    video: t("canvas.toolbar.video"),
    audio: t("canvas.toolbar.audio"),
    config: t("canvas.toolbar.config"),
    group: t("canvas.toolbar.group"),
    extensions: t("canvas.toolbar.extensions"),
    upload: t("canvas.toolbar.upload"),
    appearance: t("canvas.toolbar.appearance"),
    delete: t("canvas.deleteSelected"),
    clear: t("canvas.toolbar.clear"),
  };

  const openMenuFrom = (name: MenuName, event: MouseEvent<HTMLButtonElement>) => {
    if (openMenu === name) {
      setOpenMenu(null);
      return;
    }
    const bar = barRef.current?.getBoundingClientRect();
    if (bar) {
      const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
      const width = Math.min(name === "extensions" ? 264 : 280, viewportWidth - 24);
      const anchor = event.currentTarget.getBoundingClientRect();
      const half = width / 2;
      const viewportCenter = Math.max(
        half + 12,
        Math.min(viewportWidth - half - 12, anchor.left + anchor.width / 2),
      );
      setMenuCenter(viewportCenter - bar.left);
    }
    setOpenMenu(name);
  };

  const invoke = (command: Exclude<CanvasToolbarCommand, "audit" | MenuName>) => {
    switch (command) {
      case "pan":
        props.onCanvasToolChange(toggleCanvasTool(props.canvasTool));
        break;
      case "undo":
        props.onUndo();
        break;
      case "redo":
        props.onRedo();
        break;
      case "focus":
        props.onFocusSelected();
        break;
      case "tidy":
        props.onTidyLayout();
        break;
      case "text":
        props.onAddText();
        break;
      case "image":
        props.onAddImage();
        break;
      case "video":
        props.onAddVideo();
        break;
      case "audio":
        props.onAddAudio();
        break;
      case "config":
        props.onAddConfig();
        break;
      case "group":
        props.onAddGroup();
        break;
      case "upload":
        props.onUpload();
        break;
      case "delete":
        props.onDelete();
        break;
      case "clear":
        props.onClear();
        break;
    }
  };

  const groupNames = {
    workflow: `${labels.undo}, ${labels.redo}, ${labels.focus}`,
    create: `${labels.text}, ${labels.image}, ${labels.video}, ${labels.audio}`,
    project: `${labels.upload}, ${labels.appearance}, ${labels.clear}`,
  };

  return (
    <div
      ref={barRef}
      className="pointer-events-none absolute bottom-5 z-50 flex justify-center"
      style={{ left: 300, right: 16 }}
      data-canvas-bottom-toolbar
    >
      <div
        className="pointer-events-auto flex h-14 max-w-full items-center gap-1 overflow-x-auto rounded-lg border px-2 shadow-lg backdrop-blur"
        style={{
          background: colors.toolbar.panel,
          borderColor: colors.toolbar.border,
          boxShadow:
            themeKey === "dark"
              ? "0 18px 45px rgba(0,0,0,.32)"
              : "0 16px 40px rgba(28,25,23,.12)",
        }}
        role="toolbar"
        aria-label={t("canvas.toolbar.actions")}
        aria-orientation="horizontal"
      >
        {groups.map((group) => (
          <div
            key={group.id}
            className="flex h-9 shrink-0 items-center gap-1 border-r px-1 last:border-r-0"
            style={{ borderColor: colors.toolbar.border }}
            role="group"
            aria-label={groupNames[group.id]}
          >
            {group.commands.map(({ id, disabled }) => {
              if (id === "audit") {
                return (
                  <span key={id} className="grid size-9 place-items-center">
                    <CanvasWorkflowAuditAction
                      nodes={props.nodes}
                      connections={props.connections}
                      onFocusNode={props.onFocusNode}
                      onRepairConnections={props.onRepairConnections}
                    />
                  </span>
                );
              }

              if (id === "extensions" || id === "appearance") {
                return (
                  <ToolbarButton
                    key={id}
                    icon={actionIcons[id]}
                    label={labels[id]}
                    active={openMenu === id}
                    expanded={openMenu === id}
                    colors={colors}
                    onClick={(event) => openMenuFrom(id, event)}
                  />
                );
              }

              const label =
                id === "pan"
                  ? `${labels.pan} · ${t("canvas.toolbar.panHint")}`
                  : labels[id];
              const active = id === "pan" && props.canvasTool === "pan";
              return (
                <ToolbarButton
                  key={id}
                  icon={actionIcons[id]}
                  label={label}
                  active={active}
                  pressed={id === "pan" ? active : undefined}
                  danger={id === "delete" || id === "clear"}
                  disabled={disabled}
                  colors={colors}
                  onClick={() => invoke(id)}
                />
              );
            })}
          </div>
        ))}
      </div>

      {openMenu === "extensions" && extensionNodes.length > 0 ? (
        <ExtensionMenu
          items={extensionNodes}
          center={menuCenter}
          colors={colors}
          title={labels.extensions}
          onSelect={(type) => {
            props.onAddExtensionNode(type);
            setOpenMenu(null);
          }}
        />
      ) : null}

      {openMenu === "appearance" ? (
        <AppearanceMenu
          center={menuCenter}
          colors={colors}
          themeKey={themeKey}
          setTheme={setTheme}
          backgroundMode={props.backgroundMode}
          onBackgroundModeChange={props.onBackgroundModeChange}
          showImageInfo={props.showImageInfo}
          onShowImageInfoChange={props.onShowImageInfoChange}
          onClose={() => setOpenMenu(null)}
        />
      ) : null}
    </div>
  );
}

function ToolbarButton({
  icon: Icon,
  label,
  colors,
  active = false,
  danger = false,
  disabled = false,
  pressed,
  expanded,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  colors: CanvasTheme;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  pressed?: boolean;
  expanded?: boolean;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className="grid size-9 shrink-0 place-items-center rounded-md transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-35 dark:hover:bg-white/10"
      style={{
        color: active
          ? colors.toolbar.activeText
          : danger
            ? "#f87171"
            : colors.toolbar.item,
        background: active ? colors.toolbar.activeBg : undefined,
      }}
      aria-label={label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-haspopup={expanded === undefined ? undefined : "dialog"}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className="size-4.5" aria-hidden="true" />
    </button>
  );
}

function ExtensionMenu({
  items,
  center,
  colors,
  title,
  onSelect,
}: {
  items: ReturnType<typeof listNodeDefinitions>;
  center: number | null;
  colors: CanvasTheme;
  title: string;
  onSelect: (type: string) => void;
}) {
  return (
    <section
      className="pointer-events-auto absolute bottom-[calc(100%+10px)] z-30 max-h-[50vh] w-[min(264px,calc(100vw-24px))] -translate-x-1/2 overflow-y-auto rounded-lg border p-2 shadow-xl backdrop-blur"
      style={{
        left: center ?? "50%",
        background: colors.toolbar.panel,
        borderColor: colors.toolbar.border,
        color: colors.toolbar.item,
      }}
      role="dialog"
      aria-label={title}
    >
      <h2 className="px-2 pb-2 pt-1 text-xs font-semibold opacity-60">{title}</h2>
      <ul className="m-0 grid list-none gap-1 p-0">
        {items.map((item) => (
          <li key={item.type}>
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-white/10"
              style={{ color: colors.toolbar.item }}
              onClick={() => onSelect(item.type)}
            >
              <span
                className="grid size-7 shrink-0 place-items-center rounded-md text-base"
                style={{ background: colors.toolbar.itemHover }}
                aria-hidden="true"
              >
                {item.icon}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {getNodeSpec(item.type).title}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AppearanceMenu({
  center,
  colors,
  themeKey,
  setTheme,
  backgroundMode,
  onBackgroundModeChange,
  showImageInfo,
  onShowImageInfoChange,
  onClose,
}: {
  center: number | null;
  colors: CanvasTheme;
  themeKey: CanvasColorTheme;
  setTheme: (theme: CanvasColorTheme) => void;
  backgroundMode: CanvasBackgroundMode;
  onBackgroundModeChange: (mode: CanvasBackgroundMode) => void;
  showImageInfo: boolean;
  onShowImageInfoChange: (show: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const modes: Array<{
    id: CanvasBackgroundMode;
    icon: LucideIcon;
    label: string;
  }> = [
    { id: "lines", icon: Grid2x2, label: t("canvas.toolbar.lines") },
    { id: "dots", icon: CircleDot, label: t("canvas.toolbar.dots") },
    { id: "blank", icon: Square, label: t("canvas.toolbar.blank") },
  ];

  return (
    <section
      className="pointer-events-auto absolute bottom-[calc(100%+10px)] z-30 w-[min(280px,calc(100vw-24px))] -translate-x-1/2 rounded-lg border p-3 shadow-xl backdrop-blur"
      style={{
        left: center ?? "50%",
        background: colors.toolbar.panel,
        borderColor: colors.toolbar.border,
        color: colors.toolbar.item,
      }}
      role="dialog"
      aria-label={t("canvas.toolbar.appearance")}
    >
      <header className="flex items-center justify-between gap-3 px-1 pb-2">
        <h2 className="text-sm font-semibold">{t("canvas.toolbar.appearance")}</h2>
        <button
          type="button"
          className="text-xs opacity-55 hover:opacity-100"
          onClick={onClose}
        >
          {t("common.close")}
        </button>
      </header>

      <h3 className="px-1 pb-1.5 text-[11px] font-medium opacity-55">
        {t("canvas.toolbar.themeMode")}
      </h3>
      <div
        className="grid grid-cols-2 gap-1 rounded-md p-1"
        style={{ background: colors.toolbar.itemHover }}
      >
        <ThemeOption themeKey={themeKey} target="light" onChange={setTheme}>
          <Sun className="size-4" />
          {t("canvas.toolbar.light")}
        </ThemeOption>
        <ThemeOption themeKey={themeKey} target="dark" onChange={setTheme}>
          <Moon className="size-4" />
          {t("canvas.toolbar.dark")}
        </ThemeOption>
      </div>

      <h3 className="mt-3 px-1 pb-1.5 text-[11px] font-medium opacity-55">
        {t("canvas.toolbar.gridStyle")}
      </h3>
      <fieldset className="grid grid-cols-3 gap-2 border-0 p-0">
        <legend className="sr-only">{t("canvas.toolbar.gridStyle")}</legend>
        {modes.map(({ id, icon: Icon, label }) => {
          const selected = backgroundMode === id;
          return (
            <button
              key={id}
              type="button"
              className="flex min-h-16 flex-col items-center justify-center gap-2 rounded-md border px-2 py-2 text-[11px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              style={{
                color: selected ? colors.toolbar.activeText : colors.toolbar.item,
                background: selected ? colors.toolbar.activeBg : colors.node.fill,
                borderColor: selected
                  ? colors.toolbar.activeText
                  : colors.toolbar.border,
              }}
              aria-pressed={selected}
              onClick={() => onBackgroundModeChange(id)}
            >
              <Icon className="size-6" strokeWidth={1.25} aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </fieldset>

      <label className="mt-3 flex items-center justify-between gap-3 rounded-md px-1.5 py-1">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-medium opacity-70">
          <Info className="size-3.5" aria-hidden="true" />
          {t("canvas.toolbar.imageInfo")}
        </span>
        <Switch
          size="small"
          checked={showImageInfo}
          onChange={onShowImageInfoChange}
          aria-label={t("canvas.toolbar.imageInfo")}
        />
      </label>
    </section>
  );
}

function ThemeOption({
  themeKey,
  target,
  onChange,
  children,
}: {
  themeKey: CanvasColorTheme;
  target: CanvasColorTheme;
  onChange: (theme: CanvasColorTheme) => void;
  children: ReactNode;
}) {
  const selected = themeKey === target;
  const colors = canvasThemes[themeKey];
  const { t } = useTranslation();
  const label =
    target === "dark" ? t("topNav.darkTheme") : t("topNav.lightTheme");
  const selectedStyle =
    themeKey === "light"
      ? { background: "#111111", color: "#ffffff" }
      : { background: colors.toolbar.activeBg, color: colors.toolbar.activeText };

  return (
    <AnimatedThemeToggler
      theme={themeKey}
      targetTheme={target}
      onThemeChange={onChange}
      className="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-sm transition"
      style={selected ? selectedStyle : { color: colors.toolbar.item }}
      aria-label={label}
      title={label}
      aria-pressed={selected}
    >
      {children}
    </AnimatedThemeToggler>
  );
}
