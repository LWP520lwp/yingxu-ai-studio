import { json } from "./api";
import { prepareSkill } from "./skillRecipe";
import type { SkillDefinition } from "./SkillMarket";
import { prepareVideoGenerationInput, videoSkillOptions } from "./videoGenerationSkill";

type SkillApi = <T>(path: string, options?: RequestInit) => Promise<T>;
type SkillContext = { api: SkillApi; assertCurrent: () => void; signal: AbortSignal };

export async function listCanvasVideoSkills(context: SkillContext) {
  context.assertCurrent();
  const directory = await context.api<SkillDefinition[]>("/skills", { signal: context.signal });
  context.assertCurrent();
  return { skills: videoSkillOptions(directory) };
}

/** Read-only, owner-scoped recipe inspection for exact migration of an older canvas node. */
export async function readCanvasVideoSkill(context: SkillContext, params: Record<string, unknown>) {
  if (typeof params.id !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(params.id)) throw new Error("视频 Skill 标识无效，请重新选择");
  context.assertCurrent();
  const definition = await context.api<SkillDefinition>(`/skills/${params.id}`, { signal: context.signal });
  context.assertCurrent();
  if (definition.id !== params.id || definition.capability !== "video" || definition.status !== "available") throw new Error("此视频 Skill 暂不可用，请重新选择");
  return definition;
}

async function requireVideoSkill(context: SkillContext, params: Record<string, unknown>, install: boolean) {
  const { id, version } = params;
  if (typeof id !== "string" || !/^[a-z0-9-]{1,100}$/.test(id) || typeof version !== "string" || !version || version.length > 64) throw new Error("视频 Skill 标识无效，请重新选择");
  context.assertCurrent();
  let definition = await context.api<SkillDefinition>(`/skills/${id}`, { signal: context.signal });
  context.assertCurrent();
  const validate = () => {
    if (definition.id !== id || definition.recipeVersion !== version || definition.capability !== "video" || definition.status !== "available") throw new Error("视频 Skill 或版本已变化，请重新选择");
  };
  validate();
  if (!definition.installed || definition.installedVersion !== version) {
    if (!install) throw new Error("请先点击“安装并使用此 Skill”，再提交生成");
    definition = await context.api<SkillDefinition>(`/workspace/skills/${id}`, { method: "PUT", body: json({ recipeVersion: version }), signal: context.signal });
    context.assertCurrent(); validate();
    if (!definition.installed || definition.installedVersion !== version) throw new Error("Skill 安装尚未确认，请重试");
  }
  return definition;
}

/** Explicit installation only. Never submits a generation or changes a canvas prompt. */
export async function installCanvasVideoSkill(context: SkillContext, params: Record<string, unknown>) {
  return videoSkillOptions([await requireVideoSkill(context, params, true)])[0];
}

/** Final recipe resolution immediately before the separate, user-confirmed video submission. */
export async function prepareCanvasVideoPrompt(context: SkillContext, params: Record<string, unknown>) {
  if (typeof params.text !== "string" || !params.text.trim() || params.text.length > 12000 || !Number.isInteger(params.referenceCount) || Number(params.referenceCount) < 0 || Number(params.referenceCount) > 4) throw new Error("视频文字或参考图数量无效");
  const definition = await requireVideoSkill(context, params, false);
  context.assertCurrent();
  // Only the reference count is used to prepare text; real asset identities stay on the generation request.
  const references = Array.from({ length: Number(params.referenceCount) }, (_, index) => `reference-${index + 1}`);
  const result = prepareVideoGenerationInput(definition, params.text, references, String(params.version));
  return { prompt: result.prompt, skillId: result.skillId, skillVersion: result.skillVersion };
}

/** Only prepares an installed, versioned recipe; submitting a generation remains a separate action. */
export async function prepareCanvasVideoSkill(context: SkillContext, params: Record<string, unknown>) {
  const { id, version, sourceNodeId, text } = params;
  if (typeof id !== "string" || !/^[a-z0-9-]{1,100}$/.test(id) ||
      typeof version !== "string" || !version || version.length > 64 ||
      typeof sourceNodeId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(sourceNodeId) ||
      text !== `@[node:${sourceNodeId}]`) throw new Error("技能或文字节点标识无效，请重新选择");
  context.assertCurrent();
  let definition = await context.api<SkillDefinition>(`/skills/${id}`, { signal: context.signal });
  context.assertCurrent();
  if (definition.id !== id || definition.recipeVersion !== version) throw new Error("技能版本已变化，请刷新选项后重试");
  if (definition.status !== "available" || definition.capability !== "video") throw new Error("该技能暂不支持视频配置");
  if (!definition.installed || definition.installedVersion !== version) {
    if (params.install !== true) throw new Error("请先安装此版本技能，或选择“安装并准备视频”");
    context.assertCurrent();
    definition = await context.api<SkillDefinition>(`/workspace/skills/${id}`, {
      method: "PUT", body: json({ recipeVersion: version }), signal: context.signal,
    });
    context.assertCurrent();
    if (definition.id !== id || definition.recipeVersion !== version || definition.capability !== "video")
      throw new Error("技能版本已变化，请重新选择");
  }
  const prepared = prepareSkill(definition, { text });
  if (prepared.kind !== "video") throw new Error("该技能暂不支持视频配置");
  context.assertCurrent();
  return prepared;
}
