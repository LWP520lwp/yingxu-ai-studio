import { expect, it } from "vitest";
import { prepareSkill } from "./skillRecipe";
import catalog from "../../api/src/main/resources/skills/catalog.json";

const definition = {
  id: "image-to-video",
  name: "图生视频",
  status: "available",
  installed: true,
  installedVersion: "1.0.0",
  recipeVersion: "1.0.0",
  inputSchema: {
    properties: {
      model: { default: "muse-video" },
      width: { default: 1280 },
      height: { default: 720 },
      duration: { default: 5 },
      url: { default: "https://untrusted.example" },
    },
  },
  recipe: {
    schemaVersion: 1,
    operation: "generation-job",
    method: "POST",
    path: "/api/jobs",
    kind: "video",
    referenceSupportMustBeConfirmed: true,
  },
};
it("应用已安装版本的声明式配方，只接收允许的创作参数", () => {
  const prepared = prepareSkill(definition);
  expect(prepared).toEqual({
    kind: "video",
    requiresReference: true,
    defaults: {
      title: "图生视频",
      skillId: "image-to-video",
      skillVersion: "1.0.0",
      model: "muse-video",
      width: 1280,
      height: 720,
      duration: 5,
    },
  });
});
it("拒绝过期安装和非平台执行目标", () => {
  expect(() =>
    prepareSkill({ ...definition, installedVersion: "0.9.0" }),
  ).toThrow("安装版本已改变");
  expect(() =>
    prepareSkill({
      ...definition,
      recipe: { ...definition.recipe, path: "https://example.org/run" },
    }),
  ).toThrow("不支持");
  expect(() => prepareSkill({ ...definition, status: "planned" })).toThrow(
    "不支持",
  );
});
it("将文字节点内容填入动作配方，并保留默认提示词供市场直接使用", () => {
  const actionSkill = {
    ...definition,
    id: "fight-video",
    inputSchema: { properties: { prompt: { default: "请填写动作情节" }, duration: { default: 8 } } },
    recipe: { ...definition.recipe, referenceSupportMustBeConfirmed: false, promptTemplate: "动作起因：{{text}}\n保持人物站位和动作连续。" },
  };
  expect(prepareSkill(actionSkill, { text: "  两人在雨中交手  " }).defaults.prompt).toBe("动作起因：两人在雨中交手\n保持人物站位和动作连续。");
  expect(prepareSkill(actionSkill).defaults.prompt).toBe("请填写动作情节");
  expect(() => prepareSkill(actionSkill, { text: "长".repeat(12000) })).toThrow("文字内容过长");
});
it("内置创作方法的实际发布清单可准备为图像或视频配置，保留各自方法而不执行请求", () => {
  const methods = catalog.filter((skill) => ["product-shot", "character-sheet", "cinema-camera", "science-visual", "storybook-scene", "space-concept"].includes(skill.id));
  expect(methods).toHaveLength(6);
  const prompts = new Set<string>();
  for (const method of methods) {
    const prepared = prepareSkill({ ...method, installed: true, installedVersion: method.recipeVersion }, { text: "创作源文字" });
    expect(prepared.kind).toBe(method.capability);
    expect(prepared.defaults.prompt).toContain("创作源文字");
    expect(prepared.defaults.skillId).toBe(method.id);
    expect(prepared.defaults.skillVersion).toBe(method.recipeVersion);
    expect(prepared.defaults.model).toBe(method.capability === "image" ? "muse-image" : "muse-video");
    expect(prepared.defaults.prompt).not.toContain("{{text}}");
    prompts.add(prepared.defaults.prompt!);
  }
  expect(prompts.size).toBe(6);
});
