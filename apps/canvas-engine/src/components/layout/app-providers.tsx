import type { ReactNode } from "react";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App, ConfigProvider } from "antd";
import enUS from "antd/es/locale/en_US";
import zhCN from "antd/es/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { useTranslation } from "react-i18next";

import type { AppLocale } from "@/i18n";
import { getAntThemeConfig } from "@/lib/app-theme";
import { useThemeStore, type ThemeName } from "@/stores/use-theme-store";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

type AppProvidersProps = { children: ReactNode };

export function AppProviders({ children }: AppProvidersProps) {
  const { i18n, t } = useTranslation();
  const theme = useThemeStore((state) => state.theme);
  const dark = theme === "dark";
  const locale = resolveAppLocale(i18n.resolvedLanguage);

  useDocumentAppearance(theme);
  useDocumentLocale(locale, t("meta.title"), t("meta.description"));

  return (
    <CanvasDesignSystemProvider dark={dark} locale={locale}>
      <CanvasQueryProvider>{children}</CanvasQueryProvider>
    </CanvasDesignSystemProvider>
  );
}

function CanvasDesignSystemProvider({
  children,
  dark,
  locale,
}: AppProvidersProps & { dark: boolean; locale: AppLocale }) {
  return (
    <ConfigProvider
      locale={locale === "zh-CN" ? zhCN : enUS}
      theme={getAntThemeConfig(dark)}
    >
      <App>{children}</App>
    </ConfigProvider>
  );
}

function CanvasQueryProvider({ children }: AppProvidersProps) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function useDocumentAppearance(theme: ThemeName) {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
  }, [theme]);
}

function useDocumentLocale(
  locale: AppLocale,
  title: string,
  description: string,
) {
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = title;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", description);
    dayjs.locale(locale === "zh-CN" ? "zh-cn" : "en");
  }, [description, locale, title]);
}

function resolveAppLocale(language: string | undefined): AppLocale {
  return language === "en-US" ? "en-US" : "zh-CN";
}
