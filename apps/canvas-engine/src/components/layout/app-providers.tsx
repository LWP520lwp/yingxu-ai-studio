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
import { useThemeStore } from "@/stores/use-theme-store";

function createApplicationQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });
}

const queryClient = createApplicationQueryClient();

type AppProvidersProps = { children: ReactNode };

export function AppProviders({ children }: AppProvidersProps) {
  const { i18n, t } = useTranslation();
  const theme = useThemeStore((state) => state.theme);
  const dark = theme === "dark";
  const locale = resolveAppLocale(i18n.resolvedLanguage);
  const title = t("meta.title");
  const description = t("meta.description");

  useEffect(() => {
    applyDocumentPresentation({ dark, theme, locale, title, description });
  }, [dark, description, locale, theme, title]);

  return (
    <ConfigProvider
      locale={locale === "zh-CN" ? zhCN : enUS}
      theme={getAntThemeConfig(dark)}
    >
      <QueryClientProvider client={queryClient}>
        <App>{children}</App>
      </QueryClientProvider>
    </ConfigProvider>
  );
}

function applyDocumentPresentation({
  dark,
  theme,
  locale,
  title,
  description,
}: {
  dark: boolean;
  theme: "light" | "dark";
  locale: AppLocale;
  title: string;
  description: string;
}) {
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = theme;
  root.lang = locale;
  document.title = title;
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute("content", description);
  dayjs.locale(locale === "zh-CN" ? "zh-cn" : "en");
}

function resolveAppLocale(language: string | undefined): AppLocale {
  return language === "en-US" ? "en-US" : "zh-CN";
}
