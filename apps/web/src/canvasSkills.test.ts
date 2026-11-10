import { describe, expect, it, vi } from "vitest";
import { installCanvasVideoSkill, listCanvasVideoSkills, prepareCanvasVideoPrompt, prepareCanvasVideoSkill, readCanvasVideoSkill } from "./canvasSkills";
import type { SkillDefinition } from "./SkillMarket";

const skill = (overrides: Partial<SkillDefinition> = {}): SkillDefinition => ({
  id: "fight-video", name: "打斗分镜", description: "动作情节", capability: "video", status: "available",
  recipeVersion: "1.0.0", installed: true, installedVersion: "1.0.0",
  inputSchema: { properties: { model: { default: "muse-video" }, duration: { default: 8 } } },
  recipe: { schemaVersion: 1, operation: "generation-job", method: "POST", path: "/api/jobs", kind: "video", promptTemplate: "设计连贯动作：{{text}}" },
  ...overrides,
});
const params = { id: "fight-video", version: "1.0.0", sourceNodeId: "text-123", text: "@[node:text-123]" };
const context = (api = vi.fn()) => ({ api, signal: new AbortController().signal, assertCurrent: vi.fn() });

describe("canvas Skill preparation boundary", () => {
  it("reads the owner-scoped recipe for migration without installing or generating", async () => {
    const ctx = context(vi.fn().mockResolvedValue(skill()));
    await expect(readCanvasVideoSkill(ctx, { id: "fight-video" })).resolves.toMatchObject({ id: "fight-video", recipe: { promptTemplate: "设计连贯动作：{{text}}" } });
    expect(ctx.api.mock.calls.map((call) => call[0])).toEqual(["/skills/fight-video"]);
    await expect(readCanvasVideoSkill(ctx, { id: "../other" })).rejects.toThrow("标识无效");
    const stale = context(vi.fn().mockImplementation(async () => { stale.assertCurrent.mockImplementation(() => { throw new Error("scope changed"); }); return skill(); }));
    await expect(readCanvasVideoSkill(stale, { id: "fight-video" })).rejects.toThrow("scope changed");
  });
  it("loads and prepares an owner's imported Skill through the same actual generation recipe path", async () => {
    const imported = skill({ id: "private-" + "a".repeat(48), source: "imported", recipe: { schemaVersion: 1, operation: "generation-job", method: "POST", path: "/api/jobs", kind: "video", promptTemplate: "保持轨道方向：{{text}}" } });
    const ctx = context(vi.fn().mockResolvedValueOnce([skill(), imported]).mockResolvedValueOnce(imported));
    const listed = await listCanvasVideoSkills(ctx);
    expect(listed.skills.find((item) => item.id === imported.id)).toMatchObject({ installed: true, source: "imported" });
    const prepared = await prepareCanvasVideoPrompt(ctx, { id: imported.id, version: imported.recipeVersion, text: "卫星运动", referenceCount: 0 });
    expect(prepared).toMatchObject({ prompt: "保持轨道方向：卫星运动", skillId: imported.id, skillVersion: imported.recipeVersion });
    expect(ctx.api.mock.calls[1][0]).toBe(`/skills/${imported.id}`);
  });
  it("resolves the installed recipe with actual input before a separate generation submission", async () => {
    const ctx = context(vi.fn().mockResolvedValue(skill()));
    const result = await prepareCanvasVideoPrompt(ctx, { id: "fight-video", version: "1.0.0", text: "雨中追逐", referenceCount: 1 });
    expect(result.prompt).toContain("设计连贯动作：雨中追逐");expect(result.prompt).toContain("参考画面");
    expect(result).toMatchObject({ skillId: "fight-video", skillVersion: "1.0.0" });
    expect(ctx.api.mock.calls.map((call) => call[0])).toEqual(["/skills/fight-video"]);
  });
  it("accepts four references for capable video channels but rejects excess references", async () => {
    const ctx = context(vi.fn().mockResolvedValue(skill()));
    await expect(prepareCanvasVideoPrompt(ctx, { id: "fight-video", version: "1.0.0", text: "镜头连贯", referenceCount: 4 })).resolves.toMatchObject({ skillId: "fight-video" });
    await expect(prepareCanvasVideoPrompt(ctx, { id: "fight-video", version: "1.0.0", text: "镜头连贯", referenceCount: 5 })).rejects.toThrow("参考图数量无效");
    expect(ctx.api).toHaveBeenCalledTimes(1);
  });
  it("does not install implicitly during generation, and explicit installation never creates a job", async () => {
    const ctx = context(vi.fn().mockResolvedValue(skill({ installed: false })));
    await expect(prepareCanvasVideoPrompt(ctx, { id: "fight-video", version: "1.0.0", text: "追逐", referenceCount: 0 })).rejects.toThrow("先点击");
    expect(ctx.api).toHaveBeenCalledTimes(1);
    ctx.api.mockReset().mockResolvedValueOnce(skill({ installed: false })).mockResolvedValueOnce(skill());
    await expect(installCanvasVideoSkill(ctx, { id: "fight-video", version: "1.0.0" })).resolves.toMatchObject({ id: "fight-video", installed: true });
    expect(ctx.api.mock.calls.map((call) => call[0])).toEqual(["/skills/fight-video", "/workspace/skills/fight-video"]);
  });
  it("exposes only usable video summaries and requires the current installed version", async () => {
    const ctx = context(vi.fn().mockResolvedValue([
      skill(), skill({ id: "old-version", installedVersion: "0.9.0" }),
      skill({ id: "planned", status: "planned" }), skill({ id: "image", capability: "image" }),
    ]));
    const result = await listCanvasVideoSkills(ctx);
    expect(result.skills.map((item) => [item.id, item.installed])).toEqual([["fight-video", true], ["old-version", false]]);
    expect(result.skills[0]).not.toHaveProperty("recipe");
  });

  it("keeps a live node token inside the recipe without submitting a job", async () => {
    const ctx = context(vi.fn().mockResolvedValue(skill()));
    const result = await prepareCanvasVideoSkill(ctx, params);
    expect(result).toMatchObject({ kind: "video", defaults: { prompt: "设计连贯动作：@[node:text-123]", skillId: "fight-video", skillVersion: "1.0.0", duration: 8 } });
    expect(ctx.api).toHaveBeenCalledTimes(1);
    expect(ctx.api.mock.calls[0][0]).toBe("/skills/fight-video");
  });

  it("installs only the version explicitly selected for installation", async () => {
    const ctx = context(vi.fn().mockResolvedValueOnce(skill({ installed: false, installedVersion: null })).mockResolvedValueOnce(skill()));
    await prepareCanvasVideoSkill(ctx, { ...params, install: true });
    expect(ctx.api.mock.calls[1]).toEqual(["/workspace/skills/fight-video", expect.objectContaining({ method: "PUT", body: '{"recipeVersion":"1.0.0"}' })]);
  });

  it("rejects changed versions and does not install silently", async () => {
    const ctx = context(vi.fn().mockResolvedValue(skill({ recipeVersion: "2.0.0" })));
    await expect(prepareCanvasVideoSkill(ctx, { ...params, install: true })).rejects.toThrow("版本已变化");
    expect(ctx.api).toHaveBeenCalledTimes(1);
    ctx.api.mockResolvedValue(skill({ installed: false }));
    await expect(prepareCanvasVideoSkill(ctx, params)).rejects.toThrow("请先安装");
    expect(ctx.api).toHaveBeenCalledTimes(2);
  });

  it("stops before installation when the project, user, or request has changed", async () => {
    let current = true;
    const ctx = context(vi.fn().mockImplementation(async () => { current = false; return skill({ installed: false }); }));
    ctx.assertCurrent.mockImplementation(() => { if (!current) throw new Error("scope changed"); });
    await expect(prepareCanvasVideoSkill(ctx, { ...params, install: true })).rejects.toThrow("scope changed");
    expect(ctx.api).toHaveBeenCalledTimes(1);
  });

  it("does not return a prepared configuration after a late install response in another scope", async () => {
    let current = true;
    const ctx = context(vi.fn().mockResolvedValueOnce(skill({ installed: false })).mockImplementationOnce(async () => { current = false; return skill(); }));
    ctx.assertCurrent.mockImplementation(() => { if (!current) throw new Error("scope changed"); });
    await expect(prepareCanvasVideoSkill(ctx, { ...params, install: true })).rejects.toThrow("scope changed");
  });

  it("rejects arbitrary prompts and malformed source identifiers before a request", async () => {
    const ctx = context();
    await expect(prepareCanvasVideoSkill(ctx, { ...params, text: "unrelated text" })).rejects.toThrow("标识无效");
    await expect(prepareCanvasVideoSkill(ctx, { ...params, sourceNodeId: "../other" })).rejects.toThrow("标识无效");
    expect(ctx.api).not.toHaveBeenCalled();
  });
});
