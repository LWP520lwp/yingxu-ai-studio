import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { canApplySkill, filterMarketSkills, skillPresentation } from "./skillMarketModel";
import type { SkillDefinition } from "./SkillMarket";

const skill = (patch: Partial<SkillDefinition> = {}): SkillDefinition => ({
  id: "image-create", name: "文生图", description: "根据画面描述创作图片", capability: "image",
  status: "available", recipeVersion: "1.0.0", installedVersion: "1.0.0", installed: true, tags: ["参考图"], ...patch,
});

const coverMarkup = (source: string) => new TextDecoder().decode(Uint8Array.from(atob(source.slice(source.indexOf(",") + 1)), (character) => character.charCodeAt(0)));

describe("Skill 封面身份与本地回退", () => {
  it("catalog中的每项内置Skill各有独立v2封面，卡片和详情使用同一描述", () => {
    const catalog = JSON.parse(readFileSync(new URL("../../api/src/main/resources/skills/catalog.json", import.meta.url), "utf8")) as SkillDefinition[];
    const covers = catalog.map((definition) => skillPresentation(definition).cover);
    expect(new Set(covers).size).toBe(catalog.length);
    for (const definition of catalog) {
      const presentation = skillPresentation(definition);
      expect(presentation.cover).toBe(`/skill-covers/${definition.id}-v2.webp`);
      expect(presentation.coverLabel).toBe("AI 创作示例");
      expect(skillPresentation({ ...definition, recipe: { schemaVersion: 1 } } as SkillDefinition).cover).toBe(presentation.cover);
    }
  });
  it("汽车导演按原始sourceId识别，不依赖各账号不同的private散列ID", () => {
    const imported = skill({ id: "private-account-one", source: "imported", sourceId: "ayu-cinematic-auto-visual", capability: "video", name: "汽车导演" });
    expect(skillPresentation(imported).cover).toBe("/skill-covers/automotive-director-v2.webp");
    expect(skillPresentation({ ...imported, id: "private-account-two" }).cover).toBe(skillPresentation(imported).cover);
    expect(skillPresentation({ id: "ayu-cinematic-auto-visual", capability: "video" }).cover).toBe("/skill-covers/automotive-director-v2.webp");
  });
  it("未知视频和图像配方使用本地题签，并按来源稳定区分构图", () => {
    const imported = skill({ id: "private-one", sourceId: "orbit-workflow", source: "imported", capability: "video", name: "轨道导演" });
    const presentation = skillPresentation(imported);
    expect(presentation.cover).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(presentation.coverLabel).toBe("个人创作配方");
    expect(presentation.cover).not.toContain("image-create.svg");
    expect(coverMarkup(presentation.cover)).toContain("轨道导演");
    expect(coverMarkup(presentation.cover)).toContain("视频创作");
    expect(skillPresentation({ ...imported, id: "private-another-owner" }).cover).toBe(presentation.cover);
    expect(skillPresentation({ ...imported, sourceId: "another-workflow" }).cover).not.toBe(presentation.cover);
    expect(coverMarkup(skillPresentation({ ...imported, capability: "image" }).cover)).toContain("图像创作");
  });
  it("导入名称和用途被XML转义，不创建脚本、事件或外部图片元素", () => {
    const imported = skill({ id: "private-untrusted", source: "imported", name: "<script>alert(1)</script>", category: '<image href="https://example.com"/>' });
    const markup = coverMarkup(skillPresentation(imported).cover);
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).toContain("&lt;image");
    expect(markup).not.toMatch(/<script|<image|<foreignObject|onload=/);
    expect(markup).toContain('xmlns="http://www.w3.org/2000/svg"');
  });
  it("未知组合工作流的用途准确，特殊或残缺Unicode名称也能生成有效本地封面", () => {
    const composed = skillPresentation({ id: "constructor", capability: "composition", name: "工作流\ud800" });
    expect(composed.label).toBe("组合工作流");
    expect(composed.cover).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(coverMarkup(composed.cover)).toContain("工作流�");
    expect(coverMarkup(composed.cover)).toContain("组合工作流");
  });
});

describe("Skill 市场选择与执行资格", () => {
  it("私人导入独立筛选，支持未知ID的已安装视频配方", () => {
    const imported = skill({ id: "private-custom", source: "imported", capability: "video", name: "轨道镜头", tags: ["科普"] });
    expect(filterMarketSkills([skill(), imported], "all", "", "imported")).toEqual([imported]);
    expect(filterMarketSkills([skill(), imported], "video", "科普", "imported")).toEqual([imported]);
    expect(canApplySkill(imported)).toBe(true);
  });
  it("可扩展创作配方，同时阻止规划中、未安装和版本不匹配的技能", () => {
    expect(canApplySkill(skill())).toBe(true);
    expect(canApplySkill(skill({ id: "fight-video", capability: "video" }))).toBe(true);
    expect(canApplySkill(skill({ status: "planned" }))).toBe(false);
    expect(canApplySkill(skill({ installed: false }))).toBe(false);
    expect(canApplySkill(skill({ updateAvailable: true }))).toBe(false);
    expect(canApplySkill(skill({ id: "character-sheet" }))).toBe(true);
    expect(canApplySkill(skill({ capability: "composition" }))).toBe(false);
    expect(canApplySkill(skill({ installedVersion: "0.9.0" }))).toBe(false);
  });
  it("搜索会组合名称、用途与标签，忽略首尾空白", () => {
    const rows = [skill(), skill({ id: "image-to-video", name: "图生视频", description: "动态镜头", capability: "video", tags: ["MOTION"] })];
    expect(filterMarketSkills(rows, "all", "  参考图 ").map((item) => item.id)).toEqual(["image-create"]);
    expect(filterMarketSkills(rows, "video", "motion").map((item) => item.id)).toEqual(["image-to-video"]);
    expect(filterMarketSkills(rows, "image", "motion")).toEqual([]);
  });
  it("已安装视图只展示当前会话目录中已安装的技能", () => {
    const rows = [skill(), skill({ id: "image-to-video", installed: false, capability: "video" })];
    expect(filterMarketSkills(rows, "all", " ", "installed").map((item) => item.id)).toEqual(["image-create"]);
  });
  it("创作用途、个人收藏与搜索可以组合，不把安装当成收藏", () => {
    const rows = [skill({ id: "science-visual", name: "科普概念可视化", favorite: true }), skill({ id: "character-sheet", name: "角色造型设定", favorite: false })];
    expect(filterMarketSkills(rows, "education", "科普", "favorites").map((item) => item.id)).toEqual(["science-visual"]);
    expect(filterMarketSkills(rows, "character", "", "favorites")).toEqual([]);
    expect(filterMarketSkills(rows, "all", "", "installed")).toHaveLength(2);
  });
});
