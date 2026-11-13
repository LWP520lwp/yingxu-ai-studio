import { create } from "zustand";

import i18n from "@/i18n";
import { CanvasNodeType, type CanvasNodeMetadata } from "@/types/canvas";
import type { CanvasNodeDefinition } from "@/types/canvas-plugin";

export type AtlasNodeSpec = Readonly<{
  width: number;
  height: number;
  title: string;
  metadata: CanvasNodeMetadata;
}>;

type Registration = Readonly<{ owner: string; definition: CanvasNodeDefinition }>;

const entries = new Map<string, Registration>();
const builtInTypes = new Set<string>(Object.values(CanvasNodeType));
const emptySpec: AtlasNodeSpec = {
  width: 340,
  height: 240,
  title: i18n.t("canvas.node.node"),
  metadata: {},
};

export const useAtlasNodeRegistryVersion = create<{ version: number }>(() => ({ version: 0 }));

function publishRegistryChange() {
  useAtlasNodeRegistryVersion.setState((state) => ({ version: state.version + 1 }));
}

function validateDefinition(value: CanvasNodeDefinition): void {
  if (!value || typeof value !== "object" || typeof value.type !== "string" || !value.type.trim()) {
    throw new Error("节点定义必须包含非空类型标识");
  }
  if (typeof value.title !== "string" || !value.title.trim()) {
    throw new Error(`节点“${value.type}”必须包含显示名称`);
  }
  const size = value.defaultSize;
  if (!size || !Number.isFinite(size.width) || size.width <= 0 || !Number.isFinite(size.height) || size.height <= 0) {
    throw new Error(`节点“${value.type}”的默认尺寸无效`);
  }
}

/** Validates the complete plugin batch before publishing any registry changes. */
export function registerAtlasNodeDefinitions(
  definitions: CanvasNodeDefinition[],
  owner = "builtin",
): void {
  if (typeof owner !== "string" || !owner.trim()) throw new Error("节点所有者标识不能为空");
  if (!Array.isArray(definitions)) throw new Error("节点定义必须是数组");

  const staged = new Map<string, CanvasNodeDefinition>();
  for (const definition of definitions) {
    validateDefinition(definition);
    const { type } = definition;
    if (owner !== "builtin" && (builtInTypes.has(type) || type.startsWith("platform:"))) {
      throw new Error(`节点类型“${type}”是平台内置类型，插件不能注册`);
    }
    const current = entries.get(type);
    if (current && current.owner !== owner) {
      throw new Error(`节点类型“${type}”已由“${current.owner}”注册`);
    }
    staged.set(type, definition);
  }

  let changed = false;
  for (const [type, definition] of staged) {
    const current = entries.get(type);
    if (current?.owner === owner && current.definition === definition) continue;
    entries.set(type, { owner, definition });
    changed = true;
  }
  if (changed) publishRegistryChange();
}

export function unregisterAtlasPluginNodes(owner: string): void {
  if (owner === "builtin") return;
  let changed = false;
  for (const [type, registration] of entries) {
    if (registration.owner !== owner) continue;
    entries.delete(type);
    changed = true;
  }
  if (changed) publishRegistryChange();
}

export function getAtlasNodeDefinition(type: string): CanvasNodeDefinition | undefined {
  return entries.get(type)?.definition;
}

export function getAtlasNodeOwner(type: string): string {
  return entries.get(type)?.owner ?? "builtin";
}

export function listAtlasNodeDefinitions(): CanvasNodeDefinition[] {
  return Array.from(entries.values(), ({ definition }) => definition);
}

export function isAtlasNodeTypeRegistered(type: string): boolean {
  return entries.has(type);
}

export function getAtlasNodeSpec(type: string): AtlasNodeSpec {
  const definition = entries.get(type)?.definition;
  if (!definition) return { ...emptySpec, metadata: { ...emptySpec.metadata } };
  return {
    width: definition.defaultSize.width,
    height: definition.defaultSize.height,
    title: definition.title,
    metadata: { ...(definition.defaultMetadata ?? {}) },
  };
}

export function isAtlasBuiltinNodeType(type: string): boolean {
  return builtInTypes.has(type);
}
