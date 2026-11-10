import { describe, expect, it } from "vitest";
import catalog from "../../api/src/main/resources/skills/catalog.json";
import { prepareVideoGenerationInput, videoSkillOptions, type VideoGenerationSkill } from "./videoGenerationSkill";

const definition = (id: string): VideoGenerationSkill => {
  const skill = catalog.find((item) => item.id === id)!;
  return { ...skill, installed: true, installedVersion: skill.recipeVersion };
};

describe("video Skill generation input", () => {
  it("includes private imported recipes without an ID allowlist and composes their real method with user text", () => {
    const imported: VideoGenerationSkill = { ...definition("fight-video"), id: "private-" + "a".repeat(48), name: "轨道讲解", source: "imported", recipe: { schemaVersion: 1, operation: "generation-job", method: "POST", path: "/api/jobs", kind: "video", promptTemplate: "先交代空间关系：{{text}}\n保持轨道方向连续。" } };
    expect(videoSkillOptions([imported])).toEqual([expect.objectContaining({ id: imported.id, name: "轨道讲解", source: "imported", installed: true })]);
    const result = prepareVideoGenerationInput(imported, "卫星掠过地球", ["frame-one"], imported.recipeVersion);
    expect(result).toMatchObject({ skillId: imported.id, skillVersion: imported.recipeVersion, referenceAssetIds: ["frame-one"] });
    expect(result.prompt).toContain("先交代空间关系：卫星掠过地球");
    expect(result.prompt).toContain("保持轨道方向连续");
  });
  it("combines the real action recipe with user text and retains reference identities", () => {
    const skill = definition("fight-video");
    const references = ["frame-one"];
    const result = prepareVideoGenerationInput(skill, " 两人在雨中交手 ", references, skill.recipeVersion);
    expect(result.prompt).toContain("两人在雨中交手");
    expect(result.prompt).toContain("动作与分镜约束");
    expect(result.prompt).toContain("参考画面");
    expect(result.prompt).not.toContain("{{text}}");
    expect(result.referenceAssetIds).toEqual(["frame-one"]);
    expect(references).toEqual(["frame-one"]);
  });
  it("offers distinct real visual-effects and camera recipes while excluding image/planned entries", () => {
    const definitions = catalog.map((skill) => ({ ...skill, installed: true, installedVersion: skill.recipeVersion }));
    const options = videoSkillOptions(definitions);
    expect(options.slice(0, 3).map((item) => item.id)).toEqual(["fight-video", "cinema-vfx", "cinema-camera"]);
    expect(options.some((item) => item.id === "image-create" || item.id === "storyboard-to-video")).toBe(false);
    const effect = prepareVideoGenerationInput(definition("cinema-vfx"), "能量从掌心逐渐扩散", []);
    const camera = prepareVideoGenerationInput(definition("cinema-camera"), "能量从掌心逐渐扩散", []);
    expect(effect.prompt).toContain("电影特效方法");expect(camera.prompt).toContain("连续影视镜头");expect(effect.prompt).not.toEqual(camera.prompt);
  });
  it("keeps custom generation independent and rejects stale, missing-reference and wrong-kind Skills", () => {
    expect(prepareVideoGenerationInput(null, "  自定义镜头  ", ["frame-one"])).toEqual({ prompt: "自定义镜头", referenceAssetIds: ["frame-one"] });
    expect(() => prepareVideoGenerationInput(definition("image-create"), "测试", [])).toThrow("视频 Skill");
    expect(() => prepareVideoGenerationInput({ ...definition("fight-video"), installed: false }, "测试", [])).toThrow("安装版本");
    expect(() => prepareVideoGenerationInput(definition("fight-video"), "测试", [], "0.0.1")).toThrow("版本已变化");
    expect(() => prepareVideoGenerationInput(definition("image-to-video"), "测试", [])).toThrow("参考图");
    expect(() => prepareVideoGenerationInput(definition("fight-video"), "长".repeat(12000), ["frame-one"])).toThrow("过长");
  });
  it("does not duplicate a static Skill method already provided as the editable default text", () => {
    const skill = definition("image-to-video");
    const method = String((skill.inputSchema?.properties as Record<string, { default?: unknown }>)?.prompt?.default || "按参考图运动");
    const staticSkill = { ...skill, recipe: { ...skill.recipe, promptTemplate: undefined }, inputSchema: { ...skill.inputSchema, properties: { prompt: { default: method } }, required: [] } };
    expect(prepareVideoGenerationInput(staticSkill, method, []).prompt).toBe(method);
    expect(prepareVideoGenerationInput(staticSkill, `${method}\n\n镜头推进`, []).prompt).toBe(`${method}\n\n镜头推进`);
  });
});
