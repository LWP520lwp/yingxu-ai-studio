import { create } from "zustand";

import i18n from "@/i18n";
import { CanvasNodeType } from "@/types/canvas";
import type { CanvasNodeMetadata } from "@/types/canvas";
import type { CanvasNodeDefinition } from "@/types/canvas-plugin";

type RegistryEntry = { owner: string; definition: CanvasNodeDefinition };
type NodeSpec = { width: number; height: number; title: string; metadata: CanvasNodeMetadata };

const registry = new Map<string, RegistryEntry>();
const RESERVED_NODE_TYPES = new Set<string>(Object.values(CanvasNodeType));
const FALLBACK_SPEC: NodeSpec = {
    width: 340,
    height: 240,
    title: i18n.t("canvas.node.node"),
    metadata: {},
};

export const useNodeRegistryVersion = create<{ version: number }>(() => ({ version: 0 }));

function publishChange() {
    useNodeRegistryVersion.setState(({ version }) => ({ version: version + 1 }));
}

function assertDefinition(definition: CanvasNodeDefinition): void {
    if (!definition || typeof definition !== "object" || typeof definition.type !== "string" || !definition.type.trim()) {
        throw new Error("节点定义必须包含非空类型标识");
    }
    if (typeof definition.title !== "string" || !definition.title.trim()) {
        throw new Error(`节点“${definition.type}”必须包含显示名称`);
    }
    if (!definition.defaultSize || !Number.isFinite(definition.defaultSize.width) || definition.defaultSize.width <= 0 ||
        !Number.isFinite(definition.defaultSize.height) || definition.defaultSize.height <= 0) {
        throw new Error(`节点“${definition.type}”的默认尺寸无效`);
    }
}

export function registerNodeDefinitions(definitions: CanvasNodeDefinition[], owner = "builtin"): void {
    if (typeof owner !== "string" || !owner.trim()) throw new Error("节点所有者标识不能为空");
    if (!Array.isArray(definitions)) throw new Error("节点定义必须是数组");

    const batch = new Map<string, CanvasNodeDefinition>();
    for (const definition of definitions) {
        assertDefinition(definition);
        if (owner !== "builtin" && (RESERVED_NODE_TYPES.has(definition.type) || definition.type.startsWith("platform:"))) {
            throw new Error(`节点类型“${definition.type}”是平台内置类型，插件不能注册`);
        }
        const existing = registry.get(definition.type);
        if (existing && existing.owner !== owner) {
            throw new Error(`节点类型“${definition.type}”已由“${existing.owner}”注册`);
        }
        batch.set(definition.type, definition);
    }

    let changed = false;
    for (const [type, definition] of batch) {
        const current = registry.get(type);
        if (current?.owner === owner && current.definition === definition) continue;
        registry.set(type, { owner, definition });
        changed = true;
    }
    if (changed) publishChange();
}

export function unregisterPluginNodes(owner: string): void {
    let changed = false;
    for (const [type, entry] of registry) {
        if (entry.owner !== owner || owner === "builtin") continue;
        registry.delete(type);
        changed = true;
    }
    if (changed) publishChange();
}

export function getNodeDefinition(type: string): CanvasNodeDefinition | undefined {
    return registry.get(type)?.definition;
}

export function getNodePluginId(type: string): string {
    return registry.get(type)?.owner || "builtin";
}

export function listNodeDefinitions(): CanvasNodeDefinition[] {
    return [...registry.values()].map(({ definition }) => definition);
}

export function isRegisteredNodeType(type: string): boolean {
    return registry.has(type);
}

export function getNodeSpec(type: string): NodeSpec {
    const definition = registry.get(type)?.definition;
    if (!definition) return { ...FALLBACK_SPEC, metadata: { ...FALLBACK_SPEC.metadata } };
    return {
        width: definition.defaultSize.width,
        height: definition.defaultSize.height,
        title: definition.title,
        metadata: { ...(definition.defaultMetadata ?? {}) },
    };
}

export function isBuiltinNodeType(type: string): boolean {
    return (Object.values(CanvasNodeType) as string[]).includes(type);
}
