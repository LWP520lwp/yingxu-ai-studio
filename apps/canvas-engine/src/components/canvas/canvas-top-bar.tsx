import { useEffect, useRef, useState } from "react";
import { BookOpen, Bot, Download, Home, Images, Keyboard, Languages, Menu, Moon, PanelLeftClose, PanelLeftOpen, Plus, Puzzle, Redo2, Sun, Undo2, Upload } from "lucide-react";
import { Button, Dropdown, Modal, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { UserStatusActions } from "@/components/layout/user-status-actions";
import { AppHelpModal } from "@/components/layout/app-help-modal";
import { canvasThemes } from "@/lib/canvas-theme";
import { useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { changeAppLocale, type AppLocale } from "@/i18n";

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
    onDeleteProject,
    onExportProject,
    onImportImage,
    onOpenPlugins,
    onUndo,
    onRedo,
    agentOpen,
    compactAgentStatus,
    onToggleAgent,
}: {
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
    onDeleteProject: () => void;
    onExportProject: () => void;
    onImportImage: () => void;
    onOpenPlugins: () => void;
    onUndo: () => void;
    onRedo: () => void;
    agentOpen: boolean;
    compactAgentStatus: { connected: boolean; enabled: boolean; activity: string };
    onToggleAgent: () => void;
}) {
    const colorTheme = useThemeStore((state) => state.theme);
    const { i18n, t } = useTranslation();
    const setTheme = useThemeStore((state) => state.setTheme);
    const locale = i18n.resolvedLanguage as AppLocale;
    const nextLocale = locale === "zh-CN" ? "en-US" : "zh-CN";
    const theme = canvasThemes[colorTheme];
    const titleRef = useRef<HTMLDivElement>(null);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);
    const sidePanelOpen = useCanvasSidePanelStore((state) => state.panelOpen);
    const toggleSidePanel = useCanvasSidePanelStore((state) => state.togglePanel);

    useEffect(() => {
        if (!isTitleEditing) return;
        const close = (event: PointerEvent) => {
            if (!titleRef.current?.contains(event.target as Node)) onFinishTitleEditing();
        };
        document.addEventListener("pointerdown", close, true);
        return () => document.removeEventListener("pointerdown", close, true);
    }, [isTitleEditing, onFinishTitleEditing]);

    return (
        <>
            <div className="pointer-events-none absolute left-0 right-0 top-0 z-50 flex h-16 items-center justify-between gap-2 pl-1 pr-3 max-[520px]:gap-1 max-[520px]:pr-2">
                <div className="pointer-events-auto flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                    <Tooltip title={sidePanelOpen ? t("canvas.collapsePanel") : t("canvas.expandPanel")}>
                        <button
                            type="button"
                            onClick={toggleSidePanel}
                            aria-label={sidePanelOpen ? t("canvas.collapsePanel") : t("canvas.expandPanel")}
                            className="grid size-7 shrink-0 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10"
                            style={{ color: theme.node.text }}
                        >
                            {sidePanelOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
                        </button>
                    </Tooltip>
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                { key: "home", icon: <Home className="size-4" />, label: t("canvas.home"), onClick: onHome },
                                { key: "docs", icon: <BookOpen className="size-4" />, label: "使用帮助", onClick: () => setHelpOpen(true) },
                                { key: "projects", icon: <Images className="size-4" />, label: t("canvas.projects"), onClick: onProjects },
                                { type: "divider" },
                                { key: "new", icon: <Plus className="size-4" />, label: t("canvas.create"), onClick: onCreateProject },
                                { type: "divider" },
                                { key: "import", icon: <Upload className="size-4" />, label: t("canvas.importAsset"), onClick: onImportImage },
                                { key: "export", icon: <Download className="size-4" />, label: t("canvas.exportCurrent"), onClick: onExportProject },
                                { type: "divider" },
                                { key: "undo", disabled: !canUndo, icon: <Undo2 className="size-4" />, label: <MenuLabel text={t("canvas.undo")} shortcut="⌘ Z" />, onClick: onUndo },
                                { key: "redo", disabled: !canRedo, icon: <Redo2 className="size-4" />, label: <MenuLabel text={t("canvas.redo")} shortcut="⌘ ⇧ Z / ⌘ Y" />, onClick: onRedo },
                                { type: "divider" },
                                { key: "plugins", icon: <Puzzle className="size-4" />, label: "画布节点插件", onClick: onOpenPlugins },
                                { key: "shortcuts", icon: <Keyboard className="size-4" />, label: t("canvas.shortcuts"), onClick: () => setShortcutsOpen(true) },
                                { key: "language", icon: <Languages className="size-4" />, label: t("topNav.switchLanguage", { language: t(nextLocale === "zh-CN" ? "locale.zhCN" : "locale.enUS") }), onClick: () => void changeAppLocale(nextLocale) },
                                { key: "theme", icon: colorTheme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />, label: t(colorTheme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme"), onClick: () => setTheme(colorTheme === "dark" ? "light" : "dark") },
                            ],
                        }}
                    >
                        <button type="button" className="grid size-7 shrink-0 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }} aria-label={t("canvas.openMenu")}>
                            <Menu className="size-4" />
                        </button>
                    </Dropdown>

                    <div ref={titleRef} className="flex min-w-0 flex-1 items-center gap-2">
                        {isTitleEditing ? (
                            <input
                                autoFocus
                                value={titleDraft}
                                maxLength={200}
                                onChange={(event) => onTitleDraftChange(event.target.value)}
                                onBlur={onFinishTitleEditing}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") onFinishTitleEditing();
                                    if (event.key === "Escape") onCancelTitleEditing();
                                }}
                                className="w-full min-w-0 max-w-[280px] bg-transparent p-0 text-left text-lg font-semibold tracking-normal outline-none max-[520px]:text-base"
                                style={{ color: theme.node.text }}
                            />
                        ) : (
                            <button
                                type="button"
                                className="block w-full min-w-0 max-w-[280px] truncate border-b border-dashed border-transparent text-left text-lg font-semibold tracking-normal transition hover:border-current max-[520px]:text-base"
                                onDoubleClick={onStartTitleEditing}
                                title={`${title} · ${t("canvas.renameHint")}`}
                            >
                                {title}
                            </button>
                        )}
                    </div>
                </div>

                <div className="pointer-events-auto flex shrink-0 items-center gap-1 max-[520px]:gap-0.5">
                    <UserStatusActions variant="canvas" onOpenShortcuts={() => setShortcutsOpen(true)} onOpenPlugins={onOpenPlugins} />
                    <span className="h-6 w-px" style={{ background: theme.toolbar.border }} />
                    <Button
                        type="text"
                        className="!h-9 !shrink-0 !rounded-lg !px-2.5 !font-medium max-[520px]:!w-8 max-[520px]:!px-0"
                        style={{ background: agentOpen ? theme.toolbar.activeBg : theme.toolbar.panel, color: theme.node.text, boxShadow: "0 10px 30px rgba(28,25,23,.10)" }}
                        icon={<Bot className="size-4" />}
                        onClick={onToggleAgent}
                        aria-label="打开 Skill 市场"
                        aria-pressed={agentOpen}
                        title="Skill 市场"
                    >
                        <span className="max-[520px]:hidden">Skill 市场</span>
                    </Button>
                </div>
            </div>
            <Modal title={t("canvas.shortcuts")} open={shortcutsOpen} onCancel={() => setShortcutsOpen(false)} footer={null} centered>
                <div className="space-y-2 border-t pt-4 text-sm" style={{ borderColor: theme.node.stroke }}>
                    <Shortcut keys={["拖动空白"]} value="抓手平移画布" />
                    <Shortcut keys={[t("canvas.shortcut.wheel")]} value={t("canvas.shortcut.zoom")} />
                    <Shortcut keys={[t("canvas.shortcut.zoomSlider")]} value={t("canvas.shortcut.preciseZoom")} />
                    <Shortcut keys={["Shift", "拖动空白"]} value={t("canvas.shortcut.boxSelect")} />
                    <Shortcut keys={["Shift / Cmd", t("canvas.shortcut.click")]} value={t("canvas.shortcut.addSelection")} />
                    <Shortcut keys={["Ctrl / Cmd", "A"]} value={t("canvas.shortcut.selectAll")} />
                    <Shortcut keys={["Ctrl / Cmd", "C / V"]} value={t("canvas.shortcut.copyPaste")} />
                    <Shortcut keys={["Ctrl / Cmd", "G"]} value={t("canvas.shortcut.group")} />
                    <Shortcut keys={["Ctrl / Cmd", "Shift", "G"]} value={t("canvas.shortcut.ungroup")} />
                    <Shortcut keys={["Ctrl / Cmd", "Z"]} value={t("canvas.undo")} />
                    <Shortcut keys={["Ctrl / Cmd", "Shift", "Z"]} value={t("canvas.redo")} />
                    <Shortcut keys={["Ctrl / Cmd", "Y"]} value={t("canvas.redo")} />
                    <Shortcut keys={["Delete / Backspace"]} value={t("canvas.shortcut.delete")} />
                    <Shortcut keys={["Esc"]} value={t("canvas.shortcut.escape")} />
                    <Shortcut keys={[t("canvas.shortcut.dropMedia")]} value={t("canvas.shortcut.upload")} />
                </div>
            </Modal>
            {helpOpen ? <AppHelpModal open onClose={() => setHelpOpen(false)} /> : null}
        </>
    );
}

function MenuLabel({ text, shortcut }: { text: string; shortcut: string }) {
    return (
        <span className="flex min-w-36 items-center justify-between gap-8">
            <span>{text}</span>
            <span className="text-xs opacity-45">{shortcut}</span>
        </span>
    );
}

function CompactAgentStatus({ status, onClick }: { status: { connected: boolean; enabled: boolean; activity: string }; onClick: () => void }) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const { t } = useTranslation();
    const label = status.connected ? t("canvas.agentConnected") : status.enabled ? t("canvas.agentConnecting", { activity: status.activity || t("canvas.connecting") }) : t("canvas.agentDisconnected");
    const dotColor = status.connected ? "#22c55e" : status.enabled ? "#f59e0b" : theme.node.muted;
    return (
        <button type="button" className="flex h-8 items-center gap-1.5 text-xs transition hover:opacity-75" style={{ color: status.connected ? "#16a34a" : status.enabled ? "#d97706" : theme.node.muted }} onClick={onClick} title={t("canvas.openAgent")}>
            <span className="size-2 rounded-full" style={{ background: dotColor }} />
            <span className="max-w-[140px] truncate">{label}</span>
        </button>
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
                            style={{ borderColor: "rgba(120,113,108,.28)", background: "linear-gradient(#fff, rgba(245,245,244,.92))", color: "rgb(68,64,60)" }}
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
