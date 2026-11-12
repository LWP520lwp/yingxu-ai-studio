import {
  modelOptionLabel,
  modelOptionName,
  selectableModelsByCapability,
  type AiConfig,
  type ModelCapability,
} from "@/stores/use-config-store";

export type ModelPickerEmptyState = {
  key: string;
  values?: Record<string, string>;
};

export function getModelPickerOptions(
  config: AiConfig,
  value: string | undefined,
  capability?: ModelCapability,
) {
  const currentLocalModel =
    config.channelMode === "local" && !capability ? [value] : [];
  const models = [
    ...currentLocalModel,
    ...selectableModelsByCapability(config, capability),
  ];
  return [
    ...new Set(models.filter((model): model is string => Boolean(model))),
  ];
}

export function getModelIconPath(model: string) {
  const name = modelOptionName(model).toLowerCase();
  if (name.includes("claude") || name.includes("anthropic"))
    return "/icons/claude.svg";
  if (name.includes("gemini") || name.includes("google"))
    return "/icons/gemini.svg";
  if (name.includes("gpt") || name.includes("openai"))
    return "/icons/openai.svg";
  if (name.includes("grok")) return "/icons/grok.svg";
  if (name.includes("deepseek")) return "/icons/deepseek.svg";
  if (name.includes("glm")) return "/icons/glm.svg";
  return "";
}

export function getModelPickerEmptyState(
  config: AiConfig,
  capability?: ModelCapability,
): ModelPickerEmptyState {
  if (capability && config.models.length) {
    return {
      key: "settingsPanels.model.assign",
      values: {
        capability: `settingsPanels.model.capabilities.${capability}`,
      },
    };
  }
  return {
    key: config.models.length
      ? "settingsPanels.model.noMatch"
      : "settingsPanels.model.addFirst",
    ...(config.models.length && capability
      ? {
          values: {
            capability: `settingsPanels.model.capabilities.${capability}`,
          },
        }
      : {}),
  };
}

export function getModelPickerLabel(config: AiConfig, model: string) {
  return modelOptionLabel(config, model);
}
