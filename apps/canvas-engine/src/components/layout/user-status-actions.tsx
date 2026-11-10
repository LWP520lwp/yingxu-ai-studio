import { lazy, Suspense, useState, type CSSProperties } from "react";
import { Tooltip } from "antd";
import { BookOpen, Keyboard, Puzzle, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { GitHubLink } from "@/components/layout/github-link";
import { APP_VERSION } from "@/constant/env";
import { AppHelpModal } from "./app-help-modal";
import { changeAppLocale, type AppLocale } from "@/i18n";
import { cn } from "@/lib/utils";
import { canvasThemes } from "@/lib/canvas-theme";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";

const LazyAppConfigModal = lazy(() => import("@/components/layout/app-config-modal").then((module) => ({ default: module.AppConfigModal })));

type UserStatusActionsProps = {
    showConfig?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
    onOpenPlugins?: () => void;
};

export function UserStatusActions({ showConfig = true, variant = "default", onOpenShortcuts, onOpenPlugins }: UserStatusActionsProps) {
    const { i18n, t } = useTranslation();
    const [helpOpen, setHelpOpen] = useState(false);
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const canvasTheme = canvasThemes[theme];
    const naturalIconClass = "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-stone-600 transition-colors hover:bg-black/5 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white [&_svg]:size-4";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;
    const gitHubClassName = "size-7 text-base";
    const gitHubStyle = iconStyle;
    const secondaryVisibility = variant === "canvas" ? "max-[760px]:hidden" : "";
    const locale = i18n.resolvedLanguage as AppLocale;
    const nextLocale = locale === "zh-CN" ? "en-US" : "zh-CN";
    const languageLabel = t("topNav.switchLanguage", { language: t(nextLocale === "zh-CN" ? "locale.zhCN" : "locale.enUS") });

    return (
        <div className="inline-flex shrink-0 items-center gap-1">
            {onOpenPlugins ? (
                <button type="button" className={cn(naturalIconClass, secondaryVisibility)} style={iconStyle} onClick={onOpenPlugins} aria-label="画布节点插件" title="画布节点插件">
                    <Puzzle className="size-4" />
                </button>
            ) : null}
            <button type="button" onClick={() => setHelpOpen(true)} className={cn(naturalIconClass, secondaryVisibility)} style={iconStyle} aria-label="使用帮助" title="使用帮助">
                <BookOpen className="size-4" />
            </button>
            {showConfig ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={() => openConfigDialog(false, "channels")} aria-label="创作设置" title="创作设置">
                    <Settings2 className="size-4" />
                </button>
            ) : null}
            <Tooltip title={languageLabel} mouseEnterDelay={0.2}>
                <button type="button" className={cn(naturalIconClass, "text-[11px] font-semibold tracking-tight", secondaryVisibility)} style={iconStyle} onClick={() => void changeAppLocale(nextLocale)} aria-label={languageLabel}>
                    {locale === "zh-CN" ? "中" : "EN"}
                </button>
            </Tooltip>
            <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} className={cn(naturalIconClass, variant === "canvas" && "max-[520px]:hidden")} style={iconStyle} aria-label={t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")} title={t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")} />
            <span className={cn("inline-flex shrink-0 text-xs font-medium text-stone-500 dark:text-stone-400", secondaryVisibility)} style={iconStyle}>{APP_VERSION}</span>
            <GitHubLink className={cn("bg-transparent hover:bg-transparent dark:hover:bg-transparent", gitHubClassName)} style={gitHubStyle} />
            {onOpenShortcuts ? (
                <button type="button" className={cn(naturalIconClass, secondaryVisibility)} style={iconStyle} onClick={onOpenShortcuts} aria-label={t("topNav.shortcuts")} title={t("topNav.shortcuts")}>
                    <Keyboard className="size-4" />
                </button>
            ) : null}
            {showConfig && isConfigOpen ? <Suspense fallback={<span role="status" className="sr-only">正在加载创作设置</span>}><LazyAppConfigModal /></Suspense> : null}
            {helpOpen ? <AppHelpModal open onClose={() => setHelpOpen(false)} /> : null}
        </div>
    );
}
