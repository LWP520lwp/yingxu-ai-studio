import { afterEach, describe, expect, it, vi } from "vitest";

import {
    getAtlasNodeDefinition as getNodeDefinition,
    getAtlasNodeOwner as getNodePluginId,
    getAtlasNodeSpec as getNodeSpec,
    isAtlasBuiltinNodeType as isBuiltinNodeType,
    isAtlasNodeTypeRegistered as isRegisteredNodeType,
    listAtlasNodeDefinitions as listNodeDefinitions,
    registerAtlasNodeDefinitions as registerNodeDefinitions,
    unregisterAtlasPluginNodes as unregisterPluginNodes,
    useAtlasNodeRegistryVersion as useNodeRegistryVersion,
} from "@/atlas-engine/model/node-registry";
import type { CanvasNodeDefinition } from "@/types/canvas-plugin";

vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));

function definition(type: string, title = type, width = 240): CanvasNodeDefinition {
    return { type, title, icon: null, defaultSize: { width, height: 120 }, defaultMetadata: { content: `seed:${type}` } };
}

afterEach(() => {
    for (const owner of ["registry-test-a", "registry-test-b"]) unregisterPluginNodes(owner);
});

describe("canvas node registry", () => {
    it("registers definitions in stable order and returns isolated list/spec containers", () => {
        const first = definition("test-a:card", "First", 300);
        const second = definition("test-a:asset", "Second");
        registerNodeDefinitions([first, second], "registry-test-a");

        expect(listNodeDefinitions().slice(-2)).toEqual([first, second]);
        expect(getNodeDefinition(first.type)).toBe(first);
        expect(getNodePluginId(first.type)).toBe("registry-test-a");
        expect(getNodeSpec(first.type)).toEqual({ width: 300, height: 120, title: "First", metadata: { content: "seed:test-a:card" } });
        expect(getNodeSpec(first.type).metadata).not.toBe(first.defaultMetadata);

        const snapshot = listNodeDefinitions();
        snapshot.pop();
        expect(isRegisteredNodeType(second.type)).toBe(true);
    });

    it("replaces the same owner's definition in place and emits one version change", () => {
        const original = definition("test-a:replace", "Original");
        const replacement = definition("test-a:replace", "Replacement");
        const before = useNodeRegistryVersion.getState().version;
        registerNodeDefinitions([original], "registry-test-a");
        registerNodeDefinitions([replacement], "registry-test-a");

        expect(getNodeDefinition(original.type)).toBe(replacement);
        expect(listNodeDefinitions().filter((item) => item.type === original.type)).toEqual([replacement]);
        expect(useNodeRegistryVersion.getState().version).toBe(before + 2);
        const stable = useNodeRegistryVersion.getState().version;
        registerNodeDefinitions([replacement], "registry-test-a");
        expect(useNodeRegistryVersion.getState().version).toBe(stable);
    });

    it("rejects cross-owner collisions atomically, without partially registering a batch", () => {
        const owned = definition("test-a:owned");
        registerNodeDefinitions([owned], "registry-test-a");
        const before = useNodeRegistryVersion.getState().version;

        expect(() => registerNodeDefinitions([definition("test-b:new"), definition(owned.type, "Collision")], "registry-test-b")).toThrow("已由“registry-test-a”注册");
        expect(isRegisteredNodeType("test-b:new")).toBe(false);
        expect(getNodeDefinition(owned.type)).toBe(owned);
        expect(useNodeRegistryVersion.getState().version).toBe(before);
    });

    it("reserves platform node identifiers before built-ins are initialized", () => {
        expect(() => registerNodeDefinitions([definition("image")], "registry-test-a")).toThrow("平台内置类型");
        expect(() => registerNodeDefinitions([definition("platform:composition")], "registry-test-a")).toThrow("平台内置类型");
        expect(isRegisteredNodeType("image")).toBe(false);
        expect(isRegisteredNodeType("platform:composition")).toBe(false);
    });

    it("resolves duplicate types within one batch by the final definition", () => {
        const first = definition("test-a:duplicate", "Earlier");
        const last = definition("test-a:duplicate", "Final");
        registerNodeDefinitions([first, last], "registry-test-a");
        expect(getNodeDefinition(last.type)).toBe(last);
        expect(listNodeDefinitions().filter((item) => item.type === last.type)).toEqual([last]);
    });

    it("unregisters only the selected plugin and leaves built-in type classification independent", () => {
        const pluginDefinition = definition("test-a:remove");
        const otherDefinition = definition("test-b:keep");
        registerNodeDefinitions([pluginDefinition], "registry-test-a");
        registerNodeDefinitions([otherDefinition], "registry-test-b");
        const before = useNodeRegistryVersion.getState().version;

        unregisterPluginNodes("registry-test-a");
        expect(getNodeDefinition(pluginDefinition.type)).toBeUndefined();
        expect(getNodePluginId(pluginDefinition.type)).toBe("builtin");
        expect(getNodeDefinition(otherDefinition.type)).toBe(otherDefinition);
        expect(isBuiltinNodeType("image")).toBe(true);
        expect(isBuiltinNodeType("test-b:keep")).toBe(false);
        expect(useNodeRegistryVersion.getState().version).toBe(before + 1);
        unregisterPluginNodes("registry-test-a");
        expect(useNodeRegistryVersion.getState().version).toBe(before + 1);
    });

    it("rejects malformed definitions and exposes a predictable fallback spec", () => {
        expect(() => registerNodeDefinitions([definition("test-a:bad", "", 100)], "registry-test-a")).toThrow("必须包含显示名称");
        expect(() => registerNodeDefinitions([definition("test-a:bad-size", "Bad", Number.NaN)], "registry-test-a")).toThrow("默认尺寸无效");
        expect(() => registerNodeDefinitions([definition(" ")], "registry-test-a")).toThrow("非空类型标识");
        expect(() => registerNodeDefinitions([], " ")).toThrow("所有者标识不能为空");
        expect(getNodeSpec("missing:type")).toEqual({ width: 340, height: 240, title: "canvas.node.node", metadata: {} });
        expect(isRegisteredNodeType("missing:type")).toBe(false);
    });

    it("returns empty, isolated metadata when a definition omits defaults", () => {
        const withoutMetadata: CanvasNodeDefinition = {
            type: "test-a:no-metadata",
            title: "No metadata",
            icon: null,
            defaultSize: { width: 240, height: 120 },
        };
        registerNodeDefinitions([withoutMetadata], "registry-test-a");

        const first = getNodeSpec(withoutMetadata.type);
        expect(first.metadata).toEqual({});
        expect(first.metadata).not.toBe(withoutMetadata.defaultMetadata);
        first.metadata.content = "changed";
        expect(getNodeSpec(withoutMetadata.type).metadata).toEqual({});
    });
});
