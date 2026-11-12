import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enUS from "@/i18n/locales/en-US";
import zhCN from "@/i18n/locales/zh-CN";

export type AppLocale = "zh-CN" | "en-US";

const LOCALE_STORAGE_KEY = "yingxu-atlas:locale:v2";
const LEGACY_LOCALE_STORAGE_KEY = "infinite-canvas:locale";

export function readStoredLocale(
  storage: Pick<Storage, "getItem" | "setItem"> | null,
): AppLocale | null {
  if (!storage) return null;
  try {
    const current = storage.getItem(LOCALE_STORAGE_KEY);
    const saved = current || storage.getItem(LEGACY_LOCALE_STORAGE_KEY);
    if (saved !== "zh-CN" && saved !== "en-US") return null;
    if (!current) {
      try {
        storage.setItem(LOCALE_STORAGE_KEY, saved);
      } catch {
        // Continue with the legacy value when storage is read-only.
      }
    }
    return saved;
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
  supportedLngs: ["zh-CN", "en-US"],
  initAsync: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export function changeAppLocale(locale: AppLocale) {
  try {
    if (typeof localStorage !== "undefined")
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Language switching still works when browser storage is disabled.
  }
  return i18n.changeLanguage(locale);
}

export default i18n;
