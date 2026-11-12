import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Segmented, Switch } from "antd";
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

type ToolbarPopover = "extensions" | "appearance";
const commandIcons: Record<
  Exclude<CanvasToolbarCommand, "audit">,
  LucideIcon
> = {
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
  const rootRef = useRef<HTMLDivElement>(null);
  const [popover, setPopover] = useState<ToolbarPopover | null>(null);
  const [popoverX, setPopoverX] = useState(0);
  const colorTheme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const theme = canvasThemes[colorTheme];
  const registryVersion = useNodeRegistryVersion((state) => state.version);
  const extensions = useMemo(
    () =>
      listNodeDefinitions().filter(
        (definition) =>
          definition.showInCreateMenu !== false &&
          getNodePluginId(definition.type) !== "builtin",
      ),
    [registryVersion],
  );
  const sections = canvasToolbarSections({
    canRedo: props.canRedo,
    canUndo: props.canUndo,
    extensionCount: extensions.length,
    selectedCount: props.selectedCount,
  });

  useEffect(() => {
    if (!popover) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setPopover(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPopover(null);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [popover]);

  const showPopover = (
    nextPopover: ToolbarPopover,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    if (popover === nextPopover) {
      setPopover(null);
      return;
    }
    const root = rootRef.current?.getBoundingClientRect();
    const button = event.currentTarget.getBoundingClientRect();
    if (root) {
      const panelHalfWidth = nextPopover === "extensions" ? 132 : 142;
      const center = button.left + button.width / 2 - root.left;
      setPopoverX(
        Math.min(root.width - panelHalfWidth, Math.max(panelHalfWidth, center)),
      );
    }
    setPopover(nextPopover);
  };

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
  const sectionLabels = {
    workflow: `${labels.undo}, ${labels.redo}, ${labels.focus}`,
    create: `${labels.text}, ${labels.image}, ${labels.video}, ${labels.audio}`,
    project: `${labels.upload}, ${labels.appearance}, ${labels.clear}`,
  };

  const commandButton = (
    command: CanvasToolbarCommand,
    disabledByState = false,
  ) => {
    if (command === "audit") {
      return (
        <div key={command} className="grid size-9 place-items-center">
          <CanvasWorkflowAuditAction
            nodes={props.nodes}
            connections={props.connections}
            onFocusNode={props.onFocusNode}
            onRepairConnections={props.onRepairConnections}
          />
        </div>
      );
    }

    if (command === "extensions" || command === "appearance") {
      const active = popover === command;
      const Icon = commandIcons[command];
      return (
        <ActionButton
          key={command}
          icon={Icon}
          label={labels[command]}
          active={active}
          expanded={active}
          toggle
          theme={theme}
          onClick={(event) => showPopover(command, event)}
        />
      );
    }

    const callbacks: Partial<Record<CanvasToolbarCommand, () => void>> = {
      pan: () => props.onCanvasToolChange(toggleCanvasTool(props.canvasTool)),
      undo: props.onUndo,
      redo: props.onRedo,
      focus: props.onFocusSelected,
      tidy: props.onTidyLayout,
      text: props.onAddText,
      image: props.onAddImage,
      video: props.onAddVideo,
      audio: props.onAddAudio,
      config: props.onAddConfig,
      group: props.onAddGroup,
      upload: props.onUpload,
      delete: props.onDelete,
      clear: props.onClear,
    };
    return (
      <ActionButton
        key={command}
        icon={commandIcons[command]}
        label={
          command === "pan"
            ? `${labels.pan} · ${t("canvas.toolbar.panHint")}`
            : labels[command]
        }
        active={command === "pan" && props.canvasTool === "pan"}
        toggle={command === "pan"}
        disabled={disabledByState}
        danger={command === "delete" || command === "clear"}
        theme={theme}
        onClick={callbacks[command]}
      />
    );
  };

  return (
    <div
      ref={rootRef}
      className="pointer-events-none absolute bottom-5 z-50 flex justify-center"
      style={{ left: 300, right: 16 }}
      data-canvas-bottom-toolbar
    >
      <div
        className="pointer-events-auto flex h-14 max-w-full items-center gap-1 overflow-x-auto rounded-lg border px-2 shadow-lg backdrop-blur"
        style={{
          background: theme.toolbar.panel,
          borderColor: theme.toolbar.border,
          boxShadow:
            colorTheme === "dark"
              ? "0 18px 45px rgba(0,0,0,.32)"
              : "0 16px 40px rgba(28,25,23,.12)",
        }}
        role="toolbar"
        aria-label={t("canvas.toolbar.actions")}
        aria-orientation="horizontal"
      >
        {sections.map((section) => (
          <div
            key={section.id}
            className="flex h-9 shrink-0 items-center gap-1 border-r px-1 last:border-r-0"
            style={{ borderColor: theme.toolbar.border }}
            role="group"
            aria-label={sectionLabels[section.id]}
          >
            {section.commands.map(({ id, disabled }) =>
              commandButton(id, disabled),
            )}
          </div>
        ))}
      </div>

      {popover === "extensions" && extensions.length > 0 ? (
        <section
          className="pointer-events-auto absolute bottom-[calc(100%+10px)] z-30 max-h-[50vh] w-[264px] -translate-x-1/2 overflow-y-auto rounded-lg border p-2 shadow-xl backdrop-blur"
          style={{
            left: popoverX || "50%",
            background: theme.toolbar.panel,
            borderColor: theme.toolbar.border,
            color: theme.toolbar.item,
          }}
          role="dialog"
          aria-label={t("canvas.toolbar.extensions")}
        >
          <h2 className="px-2 pb-2 pt-1 text-xs font-semibold opacity-60">
            {t("canvas.toolbar.extensions")}
          </h2>
          <ul className="grid list-none gap-1 p-0">
            {extensions.map((definition) => (
              <li key={definition.type}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-white/10"
                  style={{ color: theme.toolbar.item }}
                  onClick={() => {
                    props.onAddExtensionNode(definition.type);
                    setPopover(null);
                  }}
                >
                  <span
                    className="grid size-7 shrink-0 place-items-center rounded-md text-base"
                    style={{ background: theme.toolbar.itemHover }}
                    aria-hidden="true"
                  >
                    {definition.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {getNodeSpec(definition.type).title}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {popover === "appearance" ? (
        <AppearancePanel
          x={popoverX}
          theme={theme}
          colorTheme={colorTheme}
          setTheme={setTheme}
          backgroundMode={props.backgroundMode}
          onBackgroundModeChange={props.onBackgroundModeChange}
          showImageInfo={props.showImageInfo}
          onShowImageInfoChange={props.onShowImageInfoChange}
          onClose={() => setPopover(null)}
        />
      ) : null}
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  theme,
  active = false,
  disabled = false,
  danger = false,
  expanded,
  toggle = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  theme: CanvasTheme;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  expanded?: boolean;
  toggle?: boolean;
  onClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className="grid size-9 shrink-0 place-items-center rounded-md transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-35 dark:hover:bg-white/10"
      style={{
        color: active
          ? theme.toolbar.activeText
          : danger
            ? "#f87171"
            : theme.toolbar.item,
        background: active ? theme.toolbar.activeBg : undefined,
      }}
      aria-label={label}
      aria-pressed={toggle ? active : undefined}
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

function AppearancePanel({
  x,
  theme,
  colorTheme,
  setTheme,
  backgroundMode,
  onBackgroundModeChange,
  showImageInfo,
  onShowImageInfoChange,
  onClose,
}: {
  x: number;
  theme: CanvasTheme;
  colorTheme: CanvasColorTheme;
  setTheme: (theme: CanvasColorTheme) => void;
  backgroundMode: CanvasBackgroundMode;
  onBackgroundModeChange: (mode: CanvasBackgroundMode) => void;
  showImageInfo: boolean;
  onShowImageInfoChange: (show: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section
      className="pointer-events-auto absolute bottom-[calc(100%+10px)] z-30 w-[280px] -translate-x-1/2 rounded-lg border p-3 shadow-xl backdrop-blur"
      style={{
        left: x || "50%",
        background: theme.toolbar.panel,
        borderColor: theme.toolbar.border,
        color: theme.toolbar.item,
      }}
      role="dialog"
      aria-label={t("canvas.toolbar.appearance")}
    >
      <header className="flex items-center justify-between gap-3 px-1 pb-2">
        <h2 className="text-sm font-semibold">
          {t("canvas.toolbar.appearance")}
        </h2>
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
        style={{ background: theme.toolbar.itemHover }}
      >
        <ThemeChoice colorTheme={colorTheme} target="light" onChange={setTheme}>
          <Sun className="size-4" />
          {t("canvas.toolbar.light")}
        </ThemeChoice>
        <ThemeChoice colorTheme={colorTheme} target="dark" onChange={setTheme}>
          <Moon className="size-4" />
          {t("canvas.toolbar.dark")}
        </ThemeChoice>
      </div>
      <h3 className="mt-3 px-1 pb-1.5 text-[11px] font-medium opacity-55">
        {t("canvas.toolbar.gridStyle")}
      </h3>
      <Segmented
        className="w-full !p-1 [&_.ant-segmented-group]:!flex [&_.ant-segmented-item]:!min-h-8 [&_.ant-segmented-item]:!flex-1 [&_.ant-segmented-item-label]:!min-h-8 [&_.ant-segmented-item-label]:!leading-8"
        value={backgroundMode}
        onChange={(value) =>
          onBackgroundModeChange(value as CanvasBackgroundMode)
        }
        options={[
          {
            value: "dots",
            label: (
              <span className="inline-flex items-center gap-1.5">
                <CircleDot className="size-4" />
                {t("canvas.toolbar.dots")}
              </span>
            ),
          },
          {
            value: "lines",
            label: (
              <span className="inline-flex items-center gap-1.5">
                <Grid2x2 className="size-4" />
                {t("canvas.toolbar.lines")}
              </span>
            ),
          },
          {
            value: "blank",
            label: (
              <span className="inline-flex items-center gap-1.5">
                <Square className="size-4" />
                {t("canvas.toolbar.blank")}
              </span>
            ),
          },
        ]}
      />
      <label className="mt-3 flex items-center justify-between gap-3 rounded-md px-1.5 py-1">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-medium opacity-70">
          <Info className="size-3.5" />
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

function ThemeChoice({
  colorTheme,
  target,
  onChange,
  children,
}: {
  colorTheme: CanvasColorTheme;
  target: CanvasColorTheme;
  onChange: (theme: CanvasColorTheme) => void;
  children: ReactNode;
}) {
  const active = colorTheme === target;
  const theme = canvasThemes[colorTheme];
  const { t } = useTranslation();
  const label =
    target === "dark" ? t("topNav.darkTheme") : t("topNav.lightTheme");
  const activeStyle =
    colorTheme === "light"
      ? { background: "#111111", color: "#ffffff" }
      : { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };

  return (
    <AnimatedThemeToggler
      theme={colorTheme}
      targetTheme={target}
      onThemeChange={onChange}
      className="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-sm transition"
      style={active ? activeStyle : { color: theme.toolbar.item }}
      aria-label={label}
      title={label}
      aria-pressed={active}
    >
      {children}
    </AnimatedThemeToggler>
  );
}
