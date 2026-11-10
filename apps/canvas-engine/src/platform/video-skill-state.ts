import type { CanvasNodeMetadata } from "@/types/canvas";
import type { SkillDefinition } from "../../../web/src/SkillMarket";

/** Old nodes stored the recipe's identity beside already-expanded text. New nodes keep user text. */
export function videoSkillSelection(metadata?: CanvasNodeMetadata) {
    const id = typeof metadata?.videoSkillId === "string" ? metadata.videoSkillId : metadata?.skillId || "";
    const legacy = Boolean(id) && metadata?.videoSkillInputMode !== "instruction";
    return {
        id,
        version: typeof metadata?.videoSkillId === "string" ? metadata.videoSkillVersion || "" : metadata?.skillVersion || "",
        legacy,
    };
}

export function videoSkillInstruction(metadata?: CanvasNodeMetadata) {
    return metadata?.composerContent ?? metadata?.prompt ?? "";
}

/** Exact reconstruction only, including repeated {{text}}. No regexp guesses or substring stripping. */
export function unwrapSkillTemplate(template: string, prompt: string): string | null {
    const parts = template.split("{{text}}");
    const occurrences = parts.length - 1;
    if (!occurrences || !prompt.startsWith(parts[0])) return null;
    const literalLength = parts.reduce((length, part) => length + part.length, 0);
    const inputLength = (prompt.length - literalLength) / occurrences;
    if (inputLength < 0 || !Number.isInteger(inputLength)) return null;
    const input = prompt.slice(parts[0].length, parts[0].length + inputLength);
    return parts.join(input) === prompt ? input : null;
}

export function recoverLegacyVideoSkill(metadata: CanvasNodeMetadata, definition: SkillDefinition): { ready: true; instruction: string } | { ready: false; reason: string } {
    const selection = videoSkillSelection(metadata);
    const instruction = videoSkillInstruction(metadata);
    if (!selection.legacy) return { ready: true, instruction };
    if (definition.id !== selection.id || definition.recipeVersion !== selection.version) return { ready: false, reason: "旧版 Skill 配方已变化，无法准确还原。原文已保留；请确认原文用途或新建配置。" };
    const template = definition.recipe?.promptTemplate;
    const defaultPrompt = (definition.inputSchema?.properties as Record<string, { default?: unknown }> | undefined)?.prompt?.default;
    if (!instruction) return { ready: true, instruction };
    if (instruction === defaultPrompt || typeof template !== "string" || !template.includes("{{text}}")) return { ready: false, reason: "此旧节点保留了默认或静态技能方法，无法确定哪些是镜头文字。原文已保留；请明确确认用途或新建空白配置。" };
    const recovered = unwrapSkillTemplate(template, instruction);
    if (recovered !== null) return { ready: true, instruction: recovered };
    return { ready: false, reason: "这是旧版 Skill 配置，无法准确区分镜头文字与已编辑的配方。原文已保留；如已含技能方法，建议新建配置。" };
}

export function videoSkillInstructionPatch(definition: Pick<SkillDefinition, "id" | "recipeVersion">, instruction: string): Partial<CanvasNodeMetadata> {
    return {
        videoSkillId: definition.id, videoSkillVersion: definition.recipeVersion,
        videoSkillInputMode: "instruction",
        skillId: undefined, skillVersion: undefined,
        prompt: instruction, composerContent: instruction,
    };
}

export function changeVideoSkillSelection(metadata: CanvasNodeMetadata | undefined, id: string, version = ""): Partial<CanvasNodeMetadata> {
    if (videoSkillSelection(metadata).legacy) throw new Error("请先确认旧配置的镜头文字，再改选或停用 Skill。原文会完整保留。");
    return { videoSkillId: id, videoSkillVersion: id ? version : "", videoSkillInputMode: "instruction", skillId: undefined, skillVersion: undefined };
}
