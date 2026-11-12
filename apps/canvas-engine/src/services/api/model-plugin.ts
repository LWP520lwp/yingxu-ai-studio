import i18n from "@/i18n";
import type { ModelCapability } from "@/stores/use-config-store";
import { getPluginTemplates } from "./model-plugin-templates";

export { runModelPlugin } from "./model-plugin-runtime";
export type { PluginHttp, PluginHttpOptions, PluginPollOptions, RunPluginArgs } from "./model-plugin-runtime";
export { getPluginTemplates } from "./model-plugin-templates";
export type { PluginTemplate } from "./model-plugin-templates";

export type PluginVariable = Readonly<{
  name: string;
  type: string;
  desc: string;
  capabilities?: readonly ModelCapability[];
}>;

const pluginVariables: readonly Omit<PluginVariable, "desc">[] = [
  { name: "prompt", type: "string", capabilities: ["image", "video", "audio"] },
  { name: "images", type: "string[]", capabilities: ["image", "video"] },
  { name: "videos", type: "File[]", capabilities: ["video"] },
  { name: "audios", type: "File[]", capabilities: ["video"] },
  { name: "messages", type: "{ role, content }[]", capabilities: ["text"] },
  { name: "params", type: "object" },
  { name: "model", type: "string" },
  { name: "baseUrl", type: "string" },
  { name: "apiKey", type: "string" },
  { name: "systemPrompt", type: "string" },
  { name: "reasoningEffort", type: '"auto" | "low" | "medium" | "high" | "xhigh"', capabilities: ["text"] },
  { name: "http", type: "object" },
  { name: "request", type: "function" },
  { name: "poll", type: "function" },
  { name: "sleep", type: "function" },
  { name: "signal", type: "AbortSignal" },
  { name: "onDelta", type: "function", capabilities: ["text"] },
  { name: "capability", type: '"image" | "video" | "text" | "audio"' },
];

export function getPluginVariables(): PluginVariable[] {
  return pluginVariables.map(({ name, type, capabilities }) => ({
    name,
    type,
    capabilities,
    desc: i18n.t(`modelPlugin.variables.${name}`),
  }));
}

export function getPluginReturn(capability: ModelCapability) {
  return i18n.t(`modelPlugin.returns.${capability}`);
}

export function getPluginAuthoringPrompt(capability: ModelCapability, modelName: string, draft = "") {
  const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);
  const eligible = getPluginVariables().filter((variable) => !variable.capabilities || variable.capabilities.includes(capability));
  const sections = [
    [t("modelPlugin.authoring.intro", {
      capability: t(`config.channelEditor.capabilities.${capability}`),
      model: modelName || t("modelPlugin.authoring.anyModel"),
    })],
    [t("modelPlugin.authoring.shape")],
    [t("modelPlugin.authoring.returnTitle"), getPluginReturn(capability)],
    [t("modelPlugin.authoring.variablesTitle"), ...eligible.map(({ name, type, desc }) => `- ${name} (${type}): ${desc}`)],
    [t("modelPlugin.authoring.rulesTitle"), t("modelPlugin.authoring.rules")],
  ];
  const examples = getPluginTemplates()[capability];
  if (examples.length) sections.push([t("modelPlugin.authoring.examplesTitle"), ...examples.flatMap((example) => [example.label, example.script])]);
  if (draft.trim()) sections.push([t("modelPlugin.authoring.draftTitle"), draft.trim()]);
  return sections.map((section) => section.join("\n")).join("\n\n");
}

export function normalizePluginImages(result: unknown): string[] {
  const values = Array.isArray(result) ? result : [result];
  const images = values.flatMap((value) => {
    if (typeof value === "string") return value ? [value] : [];
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    if (typeof record.dataUrl === "string" && record.dataUrl) return [record.dataUrl];
    if (typeof record.url === "string" && record.url) return [record.url];
    if (typeof record.b64_json === "string" && record.b64_json) return [`data:image/png;base64,${record.b64_json}`];
    return [];
  });
  if (!images.length) throw new Error(i18n.t("modelPlugin.noImages"));
  return images;
}
