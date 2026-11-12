import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enUS from "@/i18n/locales/en-US";
import zhCN from "@/i18n/locales/zh-CN";
import { LEGACY_STORAGE_KEYS } from "@/lib/legacy-data-compatibility";

export type AppLocale = "zh-CN" | "en-US";

const LOCALE_STORAGE_KEY = "yingxu-atlas:locale:v2";
const APP_LOCALES = new Set<AppLocale>(["zh-CN", "en-US"]);

function isAppLocale(value: string | null): value is AppLocale {
  return value !== null && APP_LOCALES.has(value as AppLocale);
}

export function readStoredLocale(
  storage: Pick<Storage, "getItem" | "setItem"> | null,
): AppLocale | null {
  if (!storage) return null;
  try {
    const current = storage.getItem(LOCALE_STORAGE_KEY);
    if (isAppLocale(current)) return current;

    const previous = storage.getItem(LEGACY_STORAGE_KEYS.locale);
    if (!isAppLocale(previous)) return null;
    try {
      storage.setItem(LOCALE_STORAGE_KEY, previous);
    } catch {
      // A read-only store can still supply the old preference for this session.
    }
    return previous;
  } catch {
    return null;
  }
}

function readPreferredLocale(): AppLocale | null {
  try {
    return readStoredLocale(
      typeof localStorage === "undefined" ? null : localStorage,
    );
  } catch {
    return null;
  }
}

i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": { translation: zhCN },
    "en-US": { translation: enUS },
  },
  lng: readPreferredLocale() || "zh-CN",
  fallbackLng: "zh-CN",
  supportedLngs: [...APP_LOCALES],
  initAsync: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export function changeAppLocale(locale: AppLocale) {
  if (!isAppLocale(locale)) return Promise.resolve(i18n);
  try {
    if (typeof localStorage !== "undefined")
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Language switching still works when browser storage is disabled.
  }
  return i18n.changeLanguage(locale);
}

export default i18n;
