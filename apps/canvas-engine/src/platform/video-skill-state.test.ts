import { describe, expect, it, vi } from "vitest";
import type { SkillDefinition } from "../../../web/src/SkillMarket";
import { changeVideoSkillSelection, recoverLegacyVideoSkill, unwrapSkillTemplate, videoSkillInstruction, videoSkillInstructionPatch, videoSkillSelection } from "./video-skill-state";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@/services/image-storage", () => ({ ensureImagePreview: vi.fn(), resolveImageUrl: vi.fn(), uploadImage: vi.fn() }));
vi.mock("@/services/file-storage", () => ({ resolveMediaUrl: vi.fn() }));
vi.mock("@/lib/canvas/canvas-node-factory", () => ({ imageMetadata: vi.fn(), referenceUrl: vi.fn() }));
import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { defaultConfig } from "@/stores/use-config-store";
import { videoSkillMetadata } from "./skill-video";
import { prepareSkill } from "../../../web/src/skillRecipe";
import { prepareVideoGenerationInput } from "../../../web/src/videoGenerationSkill";
import catalog from "../../../api/src/main/resources/skills/catalog.json";

const definition: SkillDefinition = { id: "private-orbit", name: "轨道镜头", description: "连续运动", capability: "video", status: "available", recipeVersion: "1.0.0", installed: true, installedVersion: "1.0.0", recipe: { promptTemplate: "连续镜头：{{text}}\n保持轨道方向。" } };
const legacy = { skillId: definition.id, skillVersion: definition.recipeVersion, prompt: "连续镜头：@[node:source]\n保持轨道方向。", composerContent: "连续镜头：@[node:source]\n保持轨道方向。" };

describe("canvas video Skill state and legacy migration", () => {
    it.each(["product-shot", "cinema-camera"])("keeps the real %s market method out of editable raw text, final user input, and disabled jobs", (id) => {
        const builtin = catalog.find((item) => item.id === id)!;
        const installed = { ...builtin, installed: true, installedVersion: builtin.recipeVersion } as SkillDefinition;
        const payload = prepareSkill(installed);
        const metadata = videoSkillMetadata(payload, { id: "muse-video", available: true });
        expect(metadata.prompt).toBe(""); expect(metadata.composerContent).toBe("");
        expect(metadata.videoSkillId).toBe(id);
        expect(metadata.videoSkillInputMode).toBe("instruction");
        expect(videoSkillSelection(metadata).legacy).toBe(false);
        const referenceMetadata = videoSkillMetadata(payload, { id: "muse-video", available: true }, "source-one");
        expect(referenceMetadata.prompt).toBe("@[node:source-one]");
        const raw = "一只玻璃杯置于窗边，镜头缓慢推进。";
        const selected = { ...metadata, prompt: raw, composerContent: raw };
        const final = prepareVideoGenerationInput(installed, selected.prompt, [], builtin.recipeVersion);
        expect(final.prompt).toBe(String(installed.recipe?.promptTemplate).split("{{text}}").join(raw));
        const off = { ...selected, ...changeVideoSkillSelection(selected, "") };
        expect(prepareVideoGenerationInput(null, off.prompt, []).prompt).toBe(raw);
        const other = { ...definition, recipe: { schemaVersion: 1, operation: "generation-job", method: "POST", path: "/api/jobs", kind: "video", promptTemplate: "新的独立方法：{{text}}" } };
        const switched = { ...selected, ...changeVideoSkillSelection(selected, other.id, other.recipeVersion) };
        expect(prepareVideoGenerationInput(other, switched.prompt, []).prompt).toBe(`新的独立方法：${raw}`);
    });
    it("requires explicit confirmation for old nonempty default prompts and static methods, preserving both exactly", () => {
        const builtin = catalog.find((item) => item.id === "product-shot")!;
        const installed = { ...builtin, installed: true, installedVersion: builtin.recipeVersion } as SkillDefinition;
        const method = String((installed.inputSchema?.properties as Record<string, { default?: unknown }>).prompt.default);
        const old = { skillId: installed.id, skillVersion: installed.recipeVersion, prompt: method, composerContent: method };
        expect(recoverLegacyVideoSkill(old, installed).ready).toBe(false);
        const interim = { videoSkillId: installed.id, videoSkillVersion: installed.recipeVersion, prompt: method, composerContent: method };
        expect(videoSkillSelection(interim).legacy).toBe(true);
        expect(recoverLegacyVideoSkill(interim, installed).ready).toBe(false);
        expect(old.prompt).toBe(method); expect(old.composerContent).toBe(method);
        const noTemplate = { ...installed, recipe: { ...installed.recipe, promptTemplate: undefined } };
        expect(recoverLegacyVideoSkill({ ...old, prompt: "用户混合了原有方法", composerContent: "用户混合了原有方法" }, noTemplate).ready).toBe(false);
        expect(() => changeVideoSkillSelection(old, "")).toThrow("先确认");
    });
    it("shows the applied Skill identity instead of falsely showing no Skill", () => {
        expect(videoSkillSelection(legacy)).toEqual({ id: definition.id, version: "1.0.0", legacy: true });
        expect(videoSkillSelection({ ...legacy, videoSkillId: "", videoSkillVersion: "" })).toEqual({ id: "", version: "", legacy: false });
    });
    it("extracts only an exactly reconstructed template, with source tokens and repeated placeholders", () => {
        expect(recoverLegacyVideoSkill(legacy, definition)).toEqual({ ready: true, instruction: "@[node:source]" });
        expect(unwrapSkillTemplate("A{{text}}B{{text}}C", "A卫星B卫星C")).toBe("卫星");
        expect(unwrapSkillTemplate("A{{text}}B{{text}}C", "A卫星B不同C")).toBeNull();
        expect(unwrapSkillTemplate("[{{text}}]", "[{{text}}]")).toBe("{{text}}");
        expect(unwrapSkillTemplate("A{{text}}B", "A文本B extra")).toBeNull();
        expect(unwrapSkillTemplate("{{text}}", "卫星运动")).toBe("卫星运动");
    });

    it("preserves the composer value when prompt metadata is absent", () => {
        expect(videoSkillInstruction({ composerContent: "只从这里恢复" })).toBe("只从这里恢复");
    });
    it("keeps uncertain user-edited text intact and requires an explicit decision", () => {
        const prompt = "一颗卫星围绕地球运动，用连续镜头展示轨道关系，比例用示意表达。";
        const edited = { ...legacy, prompt, composerContent: prompt };
        expect(recoverLegacyVideoSkill(edited, definition).ready).toBe(false);
        expect(edited.composerContent).toBe(prompt);
        expect(() => changeVideoSkillSelection(edited, "")).toThrow("先确认");
        const confirmed = { ...edited, ...videoSkillInstructionPatch(definition, prompt) };
        expect(confirmed.prompt).toBe(prompt); expect(confirmed.composerContent).toBe(prompt);
        expect(videoSkillSelection(confirmed)).toEqual({ id: definition.id, version: "1.0.0", legacy: false });
        expect(recoverLegacyVideoSkill(legacy, { ...definition, recipeVersion: "2.0.0" }).ready).toBe(false);
    });
    it("safely migrates a blank market-created Skill node to real dynamic recipe selection", () => {
        expect(recoverLegacyVideoSkill({ ...legacy, prompt: "", composerContent: "" }, definition)).toEqual({ ready: true, instruction: "" });
    });
    it("reselects, changes and disables recipes without changing the raw instruction or retaining an old wrapper", () => {
        const migrated = { ...legacy, ...videoSkillInstructionPatch(definition, "@[node:source]") };
        const same = { ...migrated, ...changeVideoSkillSelection(migrated, definition.id, "1.0.0") };
        expect(same.composerContent).toBe("@[node:source]");
        const changed = { ...same, ...changeVideoSkillSelection(same, "cinema-vfx", "1.0.0") };
        expect(changed.composerContent).toBe("@[node:source]");
        expect(changed.skillId).toBeUndefined();
        const disabled = { ...changed, ...changeVideoSkillSelection(changed, "") };
        expect(videoSkillSelection(disabled).id).toBe("");
        expect(disabled.prompt).toBe("@[node:source]");
        expect(disabled.composerContent).not.toContain("保持轨道方向");
    });
    it("carries dynamic selection and legacy review into actual generation config, independently from images", () => {
        const node: CanvasNodeData = { id: "config", title: "镜头", type: CanvasNodeType.Config, position: { x: 0, y: 0 }, width: 340, height: 200, metadata: legacy };
        expect(buildGenerationConfig(defaultConfig, node, "video")).toMatchObject({ videoSkillId: definition.id, videoSkillReviewRequired: true, appliedSkillId: undefined });
        node.metadata = { ...legacy, ...videoSkillInstructionPatch(definition, "卫星运动") };
        expect(buildGenerationConfig(defaultConfig, node, "video")).toMatchObject({ videoSkillId: definition.id, videoSkillReviewRequired: false, appliedSkillId: undefined });
        node.metadata = { ...node.metadata, ...changeVideoSkillSelection(node.metadata, "") };
        expect(buildGenerationConfig(defaultConfig, node, "video")).toMatchObject({ videoSkillId: "", videoSkillReviewRequired: false, appliedSkillId: undefined });
        expect(buildGenerationConfig(defaultConfig, node, "image").videoSkillId).toBeUndefined();
    });
});
