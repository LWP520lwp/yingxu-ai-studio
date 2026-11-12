import { afterEach, describe, expect, it, vi } from "vitest";

import i18n, { changeAppLocale, readStoredLocale } from "@/i18n";
import { LEGACY_STORAGE_KEYS } from "@/lib/legacy-data-compatibility";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("locale preference storage", () => {
  it("migrates a valid legacy locale to the product-owned preference key", () => {
    const values = new Map<string, string>([[LEGACY_STORAGE_KEYS.locale, "en-US"]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    expect(readStoredLocale(storage)).toBe("en-US");
    expect(values.get("yingxu-atlas:locale:v2")).toBe("en-US");
  });

  it("prefers the current locale key and ignores unsupported values", () => {
    const values = new Map([
      ["yingxu-atlas:locale:v2", "zh-CN"],
      [LEGACY_STORAGE_KEYS.locale, "en-US"],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    expect(readStoredLocale(storage)).toBe("zh-CN");
    expect(
      readStoredLocale({ getItem: () => "fr-FR", setItem: () => {} }),
    ).toBeNull();
  });

  it("recovers a valid old preference when the current key is corrupted", () => {
    const values = new Map([
      ["yingxu-atlas:locale:v2", "fr-FR"],
      [LEGACY_STORAGE_KEYS.locale, "en-US"],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(readStoredLocale(storage)).toBe("en-US");
    expect(values.get("yingxu-atlas:locale:v2")).toBe("en-US");
  });

  it("changes language when browser storage is unavailable", async () => {
    vi.stubGlobal("localStorage", undefined);
    await changeAppLocale("en-US");
    expect(i18n.language).toBe("en-US");
    await changeAppLocale("zh-CN");
  });

  it("keeps language switching available when browser storage throws", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("storage unavailable");
      },
      setItem: () => {
        throw new Error("storage unavailable");
      },
    });
    await expect(changeAppLocale("en-US")).resolves.toBeDefined();
    expect(i18n.language).toBe("en-US");
    await changeAppLocale("zh-CN");
  });
});
