import { prepareSkill, type SkillRecipeDefinition } from "./skillRecipe";

export type VideoGenerationSkill = SkillRecipeDefinition & { capability: string; description?: string; source?: "builtin" | "imported" };
export type VideoSkillOption = { id: string; name: string; version: string; installed: boolean; description?: string; requiresReference?: boolean; source?: "builtin" | "imported" };
const order = ["fight-video", "cinema-vfx", "cinema-camera", "image-to-video", "product-shot"];

export function videoSkillOptions(definitions: readonly VideoGenerationSkill[]): VideoSkillOption[] {
  return definitions.filter((skill) => skill.capability === "video" && skill.status === "available")
    .map((skill) => ({ id: skill.id, name: skill.name, version: skill.recipeVersion,
      installed: skill.installed === true && skill.installedVersion === skill.recipeVersion,
      description: skill.description,
      source: skill.source,
      requiresReference: Array.isArray(skill.inputSchema?.required) && skill.inputSchema.required.includes("referenceAssetIds"),
    })).sort((a, b) => (order.indexOf(a.id) < 0 ? order.length : order.indexOf(a.id)) - (order.indexOf(b.id) < 0 ? order.length : order.indexOf(b.id)));
}

/** Composes an installed declarative recipe. No network, media generation, or reference identity changes. */
export function prepareVideoGenerationInput(skill: VideoGenerationSkill | null, instruction: string, references: readonly string[] = [], expectedVersion?: string) {
  const text = instruction.trim();
  if (!text || text.length > 12000) throw new Error("请填写 1–12000 字符的镜头内容");
  const referenceAssetIds = [...new Set(references)];
  if (referenceAssetIds.length > 4 || referenceAssetIds.some((id) => !/^[a-zA-Z0-9_-]{1,128}$/.test(id))) throw new Error("视频参考图须使用当前项目素材，最多四张；实际数量以所选通道为准");
  if (!skill) return { prompt: text, referenceAssetIds };
  if (skill.capability !== "video" || (expectedVersion && expectedVersion !== skill.recipeVersion)) throw new Error("视频 Skill 或版本已变化，请重新选择");
  const required = skill.inputSchema?.required;
  if (Array.isArray(required) && required.includes("referenceAssetIds") && !referenceAssetIds.length) throw new Error("此 Skill 需要至少一张参考图，请先连接或选择图片");
  const prepared = prepareSkill(skill, { text });
  if (prepared.kind !== "video") throw new Error("此 Skill 不能用于视频生成");
  const hasTemplate = typeof skill.recipe?.promptTemplate === "string" && skill.recipe.promptTemplate.includes("{{text}}");
  const method = prepared.defaults.prompt?.trim();
  let prompt = hasTemplate ? prepared.defaults.prompt || text : !method || text === method || text.startsWith(`${method}\n\n`) ? text : [method, text].join("\n\n");
  if (referenceAssetIds.length) prompt += "\n\n【参考画面】\n以随任务提供的参考图片保持人物外观、服装、主体比例与场景风格连贯。用户描述中的动作和运镜应在该画面基础上展开。";
  if (prompt.length > 12000) throw new Error("组合 Skill 后的提示词过长，请缩短镜头内容");
  return { prompt, referenceAssetIds, skillId: skill.id, skillVersion: skill.recipeVersion };
}
