export type ModelCapability = "text" | "vision" | "image" | "video";
export const capabilityNames: Record<ModelCapability, string> = {
  text: "文本理解", vision: "图像理解", image: "图像生成", video: "视频生成",
};
export type ChannelModel = { name: string; capability: ModelCapability };
export type GenerationChannel = {
  id: string; name: string; baseUrl: string; apiFormat: "openai"; enabled: boolean;
  hasKey: boolean; models: ChannelModel[];
};
export type ModelCandidate = {
  name: string; capability: ModelCapability | "unknown"; selected: boolean;
  source: "configured" | "provider" | "name-hint" | "unknown" | "manual";
};
export type DiscoveredModel = Omit<ModelCandidate, "selected"> & { requiresConfirmation: boolean };
export const modelNamePattern = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,63}$/;
export const isCapability = (value: string): value is ModelCapability => Object.hasOwn(capabilityNames, value);
export const configuredCandidates = (models: ChannelModel[]): ModelCandidate[] => models.map((model) => ({ ...model, selected: true, source: "configured" }));

/** Discovery adds suggestions, preserving every explicit selection and role already made by the user. */
export function mergeDiscoveredModels(current: ModelCandidate[], discovered: DiscoveredModel[]): ModelCandidate[] {
  const result = new Map(current.map((model) => [model.name, model]));
  for (const model of discovered) {
    if (result.has(model.name) || !modelNamePattern.test(model.name) || result.size >= 100) continue;
    result.set(model.name, { name: model.name, capability: isCapability(model.capability) ? model.capability : "unknown", source: model.source, selected: false });
  }
  return [...result.values()];
}

/** Unknown or unchecked provider entries can never become an enabled model implicitly. */
export function selectedChannelModels(candidates: ModelCandidate[]): ChannelModel[] {
  const result: ChannelModel[] = [];
  const names = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.selected) continue;
    const name = candidate.name.trim();
    if (!modelNamePattern.test(name)) throw new Error("模型 ID 须为 1–64 个字母、数字或 . _ / -，且以字母或数字开头。");
    if (!isCapability(candidate.capability)) throw new Error(`请为 ${name} 确认模型能力。`);
    if (names.has(name)) throw new Error("模型 ID 重复，请保留一项。");
    names.add(name); result.push({ name, capability: candidate.capability });
  }
  if (result.length > 100) throw new Error("每个渠道最多配置 100 个模型。");
  return result;
}
