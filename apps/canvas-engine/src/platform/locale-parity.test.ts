import { describe, expect, it } from "vitest";
import * as ts from "typescript";

import enUS from "@/i18n/locales/en-US";
import zhCN from "@/i18n/locales/zh-CN";

type MessageMap = Map<string, string>;

function collectMessages(
  value: unknown,
  prefix = "",
  output: MessageMap = new Map(),
) {
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
  it("resolves literal translation keys used by production code", () => {
    const locales = [collectMessages(zhCN), collectMessages(enUS)];
    const sources = import.meta.glob<string>(
      ["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}"],
      { eager: true, query: "?raw", import: "default" },
    );
    const missing: string[] = [];

    for (const [file, source] of Object.entries(sources)) {
      const syntax = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const visit = (node: ts.Node) => {
        if (
          ts.isCallExpression(node) &&
          ((ts.isIdentifier(node.expression) && node.expression.text === "t") ||
            (ts.isPropertyAccessExpression(node.expression) &&
              node.expression.name.text === "t"))
        ) {
          const key = node.arguments[0];
          if (
            key &&
            ts.isStringLiteralLike(key) &&
            locales.some((messages) => !messages.has(key.text))
          ) {
            const { line } = syntax.getLineAndCharacterOfPosition(
              key.getStart(syntax),
            );
            missing.push(`${file}:${line + 1}: ${key.text}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(syntax);
    }

    expect(missing).toEqual([]);
  });

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
