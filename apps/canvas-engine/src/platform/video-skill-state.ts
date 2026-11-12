import type { CanvasNodeMetadata } from "@/types/canvas";
import type { SkillDefinition } from "../../../web/src/SkillMarket";

type SkillChoice = { id: string; version: string; legacy: boolean };
type SkillRecovery = { ready: true; instruction: string } | { ready: false; reason: string };

function textField(value: unknown): string {
    return typeof value === "string" ? value : "";
}

/** Reads the saved recipe selection and identifies records written by the earlier inline-template format. */
export function videoSkillSelection(metadata?: CanvasNodeMetadata): SkillChoice {
    const usesCurrentSchema = metadata != null && Object.prototype.hasOwnProperty.call(metadata, "videoSkillId");
    const id = usesCurrentSchema ? textField(metadata.videoSkillId) : textField(metadata?.skillId);
    const version = usesCurrentSchema ? textField(metadata.videoSkillVersion) : textField(metadata?.skillVersion);
    const legacy = Boolean(id) && metadata?.videoSkillInputMode !== "instruction";
    return { id, version, legacy };
}

export function videoSkillInstruction(metadata?: CanvasNodeMetadata): string {
    if (typeof metadata?.composerContent === "string") return metadata.composerContent;
    return textField(metadata?.prompt);
}

/** Returns input text only when substituting it recreates the entire stored recipe string. */
export function unwrapSkillTemplate(template: string, prompt: string): string | null {
    const fragments = template.split("{{text}}");
    const placeholders = fragments.length - 1;
    if (placeholders === 0 || !prompt.startsWith(fragments[0])) return null;
    const fixedLength = fragments.reduce((sum, fragment) => sum + fragment.length, 0);
    const candidateLength = (prompt.length - fixedLength) / placeholders;
    if (candidateLength < 0 || !Number.isInteger(candidateLength)) return null;
    const candidate = prompt.slice(fragments[0].length, fragments[0].length + candidateLength);
    return fragments.join(candidate) === prompt ? candidate : null;
}

function recipeDefault(definition: SkillDefinition): unknown {
    const properties = definition.inputSchema?.properties;
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) return undefined;
    const prompt = (properties as Record<string, unknown>).prompt;
    if (!prompt || typeof prompt !== "object" || Array.isArray(prompt)) return undefined;
    return (prompt as { default?: unknown }).default;
}

export function recoverLegacyVideoSkill(metadata: CanvasNodeMetadata, definition: SkillDefinition): SkillRecovery {
    const choice = videoSkillSelection(metadata);
    const instruction = videoSkillInstruction(metadata);
    if (!choice.legacy) return { ready: true, instruction };
    if (definition.id !== choice.id || definition.recipeVersion !== choice.version) {
        return { ready: false, reason: "旧版 Skill 配方已变化，无法准确还原。原文已保留；请确认原文用途或新建配置。" };
    }

    const template = definition.recipe?.promptTemplate;
    if (!instruction) return { ready: true, instruction };
    if (instruction === recipeDefault(definition) || typeof template !== "string" || !template.includes("{{text}}")) {
        return { ready: false, reason: "此旧节点保留了默认或静态技能方法，无法确定哪些是镜头文字。原文已保留；请明确确认用途或新建空白配置。" };
    }

    const recovered = unwrapSkillTemplate(template, instruction);
    if (recovered !== null) return { ready: true, instruction: recovered };
    return { ready: false, reason: "这是旧版 Skill 配置，无法准确区分镜头文字与已编辑的配方。原文已保留；如已含技能方法，建议新建配置。" };
}

export function videoSkillInstructionPatch(
    definition: Pick<SkillDefinition, "id" | "recipeVersion">,
    instruction: string,
): Partial<CanvasNodeMetadata> {
    return {
        videoSkillId: definition.id,
        videoSkillVersion: definition.recipeVersion,
        videoSkillInputMode: "instruction",
        skillId: undefined,
        skillVersion: undefined,
        prompt: instruction,
        composerContent: instruction,
    };
}

export function changeVideoSkillSelection(metadata: CanvasNodeMetadata | undefined, id: string, version = ""): Partial<CanvasNodeMetadata> {
    if (videoSkillSelection(metadata).legacy) throw new Error("请先确认旧配置的镜头文字，再改选或停用 Skill。原文会完整保留。");
    return {
        videoSkillId: id,
        videoSkillVersion: id ? version : "",
        videoSkillInputMode: "instruction",
        skillId: undefined,
        skillVersion: undefined,
    };
}
