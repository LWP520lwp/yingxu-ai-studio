import type { CreativeData } from "./types";

export type SkillRecipeDefinition = {
  id: string;
  name: string;
  recipeVersion: string;
  installed?: boolean;
  installedVersion?: string | null;
  status: string;
  inputSchema?: Record<string, unknown>;
  recipe?: Record<string, unknown>;
};
export function prepareSkill(definition: SkillRecipeDefinition, context?: { text?: string }) {
  const { recipe, inputSchema } = definition;
  if (
    !definition.installed ||
    definition.installedVersion !== definition.recipeVersion
  )
    throw new Error("技能安装版本已改变，请刷新市场后重试。");
  if (
    definition.status !== "available" ||
    recipe?.schemaVersion !== 1 ||
    recipe.operation !== "generation-job" ||
    recipe.method !== "POST" ||
    recipe.path !== "/api/jobs" ||
    !["image", "video"].includes(String(recipe.kind))
  )
    throw new Error("当前版本不支持这个技能的执行步骤。");
  const kind = recipe.kind as "image" | "video";
  const properties = inputSchema?.properties as
    | Record<string, { default?: unknown }>
    | undefined;
  const defaults: Partial<CreativeData> = {
    title: definition.name.slice(0, 100),
    skillId: definition.id,
    skillVersion: definition.recipeVersion,
  };
  for (const key of ["width", "height", "duration"] as const) {
    const value = properties?.[key]?.default;
    if (
      typeof value === "number" &&
      Number.isInteger(value) &&
      (key === "duration"
        ? value >= 2 && value <= 20
        : value >= 64 && value <= 4096)
    )
      defaults[key] = value;
  }
  const model = properties?.model?.default;
  if (typeof model === "string" && model.length <= 120) defaults.model = model;
  const prompt = properties?.prompt?.default;
  if (typeof prompt === "string" && prompt.trim() && prompt.length <= 12000) defaults.prompt = prompt;
  const sourceText = context?.text?.trim();
  const promptTemplate = recipe.promptTemplate;
  if (sourceText && typeof promptTemplate === "string" && promptTemplate.includes("{{text}}")) {
    const preparedPrompt = promptTemplate.split("{{text}}").join(sourceText);
    if (preparedPrompt.length > 12000) throw new Error("文字内容过长，请缩短后再应用技能。");
    defaults.prompt = preparedPrompt;
  }
  return {
    kind,
    defaults,
    requiresReference: recipe.referenceSupportMustBeConfirmed === true,
  };
}
