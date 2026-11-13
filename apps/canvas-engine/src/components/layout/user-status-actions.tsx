import {
  lazy,
  Suspense,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
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

const ConfigDialog = lazy(() =>
  import("@/components/layout/app-config-workspace").then(
    ({ AppConfigModal }) => ({ default: AppConfigModal }),
  ),
);

type UserStatusActionsProps = {
  showConfig?: boolean;
  variant?: "default" | "canvas";
  onOpenShortcuts?: () => void;
  onOpenPlugins?: () => void;
};

type IconActionProps = {
  label: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
};

const iconButtonClass =
  "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-stone-600 transition-colors hover:bg-black/5 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white [&_svg]:size-4";

function IconAction({
  label,
  onClick,
  children,
  className,
  style,
}: IconActionProps) {
  return (
    <button
      type="button"
      className={cn(iconButtonClass, className)}
      style={style}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

export function UserStatusActions({
  showConfig = true,
  variant = "default",
  onOpenShortcuts,
  onOpenPlugins,
}: UserStatusActionsProps) {
  const { i18n, t } = useTranslation();
  const [helpVisible, setHelpVisible] = useState(false);
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const openConfig = useConfigStore((state) => state.openConfigDialog);
  const configVisible = useConfigStore((state) => state.isConfigOpen);

  const canvasStyle: CSSProperties | undefined =
    variant === "canvas" ? { color: canvasThemes[theme].node.text } : undefined;
  const compactOnly = variant === "canvas" ? "max-[760px]:hidden" : "";
  const locale = i18n.resolvedLanguage as AppLocale;
  const alternateLocale: AppLocale = locale === "zh-CN" ? "en-US" : "zh-CN";
  const languageLabel = t("topNav.switchLanguage", {
    language: t(alternateLocale === "zh-CN" ? "locale.zhCN" : "locale.enUS"),
  });

  return (
    <div className="inline-flex shrink-0 items-center gap-1">
      {onOpenPlugins && (
        <IconAction
          label={t("canvas.plugins.title")}
          onClick={onOpenPlugins}
          className={compactOnly}
          style={canvasStyle}
        >
          <Puzzle />
        </IconAction>
      )}
      <IconAction
        label={t("topNav.help")}
        onClick={() => setHelpVisible(true)}
        className={compactOnly}
        style={canvasStyle}
      >
        <BookOpen />
      </IconAction>
      {showConfig && (
        <IconAction
          label={t("topNav.creationSettings")}
          onClick={() => openConfig(false, "channels")}
          style={canvasStyle}
        >
          <Settings2 />
        </IconAction>
      )}
      <Tooltip title={languageLabel} mouseEnterDelay={0.2}>
        <button
          type="button"
          className={cn(
            iconButtonClass,
            "text-[11px] font-semibold tracking-tight",
            compactOnly,
          )}
          style={canvasStyle}
          onClick={() => void changeAppLocale(alternateLocale)}
          aria-label={languageLabel}
        >
          {locale === "zh-CN" ? "中" : "EN"}
        </button>
      </Tooltip>
      <AnimatedThemeToggler
        theme={theme}
        onThemeChange={setTheme}
        className={cn(
          iconButtonClass,
          variant === "canvas" && "max-[520px]:hidden",
        )}
        style={canvasStyle}
        aria-label={t(
          theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme",
        )}
        title={t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")}
      />
      <span
        className={cn(
          "inline-flex shrink-0 text-xs font-medium text-stone-500 dark:text-stone-400",
          compactOnly,
        )}
        style={canvasStyle}
      >
        {APP_VERSION}
      </span>
      <GitHubLink
        className="size-7 bg-transparent text-base hover:bg-transparent dark:hover:bg-transparent"
        style={canvasStyle}
      />
      {onOpenShortcuts && (
        <IconAction
          label={t("topNav.shortcuts")}
          onClick={onOpenShortcuts}
          className={compactOnly}
          style={canvasStyle}
        >
          <Keyboard />
        </IconAction>
      )}
      {showConfig && configVisible && (
        <Suspense
          fallback={
            <span role="status" className="sr-only">
              正在加载创作设置
            </span>
          }
        >
          <ConfigDialog />
        </Suspense>
      )}
      {helpVisible && (
        <AppHelpModal open onClose={() => setHelpVisible(false)} />
      )}
    </div>
  );
}
