import { describe, expect, it } from "vitest";

import enUS from "@/i18n/locales/en-US";
import zhCN from "@/i18n/locales/zh-CN";

type MessageMap = Map<string, string>;

function collectMessages(value: unknown, prefix = "", output: MessageMap = new Map()) {
  if (typeof value === "string") {
    output.set(prefix, value);
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectMessages(entry, `${prefix}.${index}`, output),
    );
    return output;
  }

  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      collectMessages(entry, prefix ? `${prefix}.${key}` : key, output);
    }
  }

  return output;
}

function interpolationTokens(message: string) {
  return [...message.matchAll(/{{\s*-?\s*([\w.]+)(?:\s*,[^}]*)?\s*}}/g)]
    .map((match) => match[1])
    .sort();
}

describe("locale message parity", () => {
  it("keeps the same message paths in Chinese and English", () => {
    const chinese = collectMessages(zhCN);
    const english = collectMessages(enUS);

    expect([...chinese.keys()].sort()).toEqual([...english.keys()].sort());
  });

  it("keeps every interpolation variable aligned between locales", () => {
    const chinese = collectMessages(zhCN);
    const english = collectMessages(enUS);

    for (const [key, chineseMessage] of chinese) {
      expect(interpolationTokens(english.get(key) ?? "")).toEqual(
        interpolationTokens(chineseMessage),
      );
    }
  });
});
