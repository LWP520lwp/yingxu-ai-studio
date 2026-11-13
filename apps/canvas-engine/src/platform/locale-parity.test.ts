import { describe, expect, it } from "vitest";
import * as ts from "typescript";
import { createInstance } from "i18next";

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

function staticKeyRequests(expression: ts.Expression): string[][] {
  if (ts.isStringLiteralLike(expression)) return [[expression.text]];
  if (ts.isArrayLiteralExpression(expression)) {
    // i18next resolves an array as an ordered list of fallbacks.
    return [
      expression.elements.flatMap((entry) =>
        ts.isStringLiteralLike(entry) ? [entry.text] : [],
      ),
    ];
  }
  if (ts.isConditionalExpression(expression)) {
    return [
      ...staticKeyRequests(expression.whenTrue),
      ...staticKeyRequests(expression.whenFalse),
    ];
  }
  return [];
}

const dynamicMessageKeys = [
  ...[
    "horizontal",
    "pitch",
    "distance",
    "free",
    "fixed",
    "originalMode",
    "maxReached",
    "targetReached",
  ].map((key) => `canvas.editors.${key}`),
  ...["high", "bilinear", "nearest"].flatMap((key) => [
    `canvas.editors.${key}`,
    `canvas.editors.${key}Description`,
  ]),
  ...["image", "video", "text", "audio"].map(
    (key) => `settingsPanels.model.capabilities.${key}`,
  ),
  ...["openai", "gemini"].map((key) => `modelPlugin.templates.${key}`),
  ...[
    "add_node",
    "update_node",
    "delete_node",
    "delete_connections",
    "connect_nodes",
    "set_viewport",
    "select_nodes",
    "run_generation",
  ].map((key) => `canvas.agentOps.${key}`),
  ...[
    "testFailed",
    "downloadFailed",
    "downloadTimeout",
    "emptyUpload",
    "uploadFailed",
    "directoryFailed",
    "requestTimeout",
    "connectionFailed",
    "urlRequired",
    "authenticationFailed",
    "pathMissing",
    "responseFailed",
    "syncFailed",
    "invalidManifest",
  ].map((key) => `config.webdav.errors.${key}`),
];

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
          if (key) {
            for (const alternatives of staticKeyRequests(key)) {
              if (
                !alternatives.length ||
                locales.every((messages) =>
                  alternatives.some((name) => messages.has(name)),
                )
              )
                continue;
              const { line } = syntax.getLineAndCharacterOfPosition(
                key.getStart(syntax),
              );
              missing.push(`${file}:${line + 1}: ${alternatives.join(" | ")}`);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(syntax);
    }

    expect(missing).toEqual([]);
  });

  it("keeps dynamic editor, model, operation and sync message contracts", () => {
    for (const messages of [collectMessages(zhCN), collectMessages(enUS)]) {
      for (const key of dynamicMessageKeys) {
        expect(messages.has(key), key).toBe(true);
      }
    }
  });

  it("renders fallback lists and placeholders in each supported language", async () => {
    const translator = createInstance();
    await translator.init({
      resources: {
        "zh-CN": { translation: zhCN },
        "en-US": { translation: enUS },
      },
      lng: "zh-CN",
      fallbackLng: false,
      initAsync: false,
    });
    for (const language of ["zh-CN", "en-US"]) {
      await translator.changeLanguage(language);
      const messages = collectMessages(language === "zh-CN" ? zhCN : enUS);
      for (const [key, message] of messages) {
        const variables = Object.fromEntries(
          interpolationTokens(message).map((name) => [name, `sample-${name}`]),
        );
        const result = translator.t(
          ["missing.message.for.fallback", key],
          variables,
        );
        expect(result, `${language}: ${key}`).not.toBe(key);
        expect(result, `${language}: ${key}`).not.toContain("{{");
      }
    }
  });

  it("recognizes conditional keys and translation fallback arrays", () => {
    const source = ts.createSourceFile(
      "requests.ts",
      't(flag ? "on" : "off"); t(["new", "old"]);',
      ts.ScriptTarget.Latest,
      true,
    );
    const calls = source.statements.map(
      (statement) =>
        (statement as ts.ExpressionStatement).expression as ts.CallExpression,
    );
    expect(staticKeyRequests(calls[0].arguments[0])).toEqual([["on"], ["off"]]);
    expect(staticKeyRequests(calls[1].arguments[0])).toEqual([["new", "old"]]);
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
