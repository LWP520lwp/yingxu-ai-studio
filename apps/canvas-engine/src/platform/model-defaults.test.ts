import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformInit } from "./rpc";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const harness = vi.hoisted(() => ({ init: null as PlatformInit | null, listeners: new Set<(init: PlatformInit) => void>() }));
vi.mock("./rpc", () => ({
    getPlatformInit: () => harness.init,
    onPlatformInit: (listener: (init: PlatformInit) => void) => { harness.listeners.add(listener); return () => harness.listeners.delete(listener); },
}));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@/lib/localforage-storage", () => ({ localForageStorage: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined } }));
vi.mock("@/services/image-storage", () => ({ ensureImagePreview: vi.fn(), resolveImageUrl: vi.fn(), uploadImage: vi.fn() }));
vi.mock("@/services/file-storage", () => ({ resolveMediaUrl: vi.fn() }));
vi.mock("@/atlas-engine/model/node-factory", () => ({ atlasImageMetadata: vi.fn(), atlasReferenceUrl: vi.fn() }));

import { defaultConfig, initializePlatformConfig, platformConfig, resolveModelForCapability, useConfigStore } from "@/stores/use-config-store";
import { buildAtlasGenerationConfig as buildGenerationConfig } from "@/atlas-engine/workflows/generation-runtime";

const uploadedImage = (): CanvasNodeData => ({ id: "uploaded", type: CanvasNodeType.Image, title: "参考图片.png", position: { x: 0, y: 0 }, width: 400, height: 400, metadata: { content: "/api/assets/uploaded/content", status: "success" } });

beforeEach(() => {
    harness.init = { scopeId: "scope", userId: "user", project: { id: "project", title: "画布" }, baseCanvasDocument: {}, snapshot: null, assets: [],
        models: { image: [{ id: "muse-image", available: false }, { id: "muse-service-image", available: true }], video: [{ id: "muse-video", available: false }, { id: "muse-service-video", available: true }] } };
    useConfigStore.setState({ config: defaultConfig });
});
afterEach(() => vi.restoreAllMocks());

describe("available defaults without rewriting saved node choices", () => {
    it("uses the ready service for an ordinary uploaded image even with stale global defaults", () => {
        const node = uploadedImage();
        expect(buildGenerationConfig(defaultConfig, node, "image").model).toBe("platform::muse-service-image");
        expect(node.metadata?.model).toBeUndefined();
        const effective = platformConfig(defaultConfig);
        expect(effective.imageModel).toBe("platform::muse-service-image");
        expect(useConfigStore.getState().isAiConfigReady(effective, effective.imageModel)).toBe(true);
    });

    it("keeps a saved unavailable model and lets readiness block it", () => {
        const node = uploadedImage(); node.metadata!.model = "platform::muse-image";
        const config = buildGenerationConfig(platformConfig(defaultConfig), node, "image");
        expect(config.model).toBe("platform::muse-image");
        expect(useConfigStore.getState().isAiConfigReady(config, config.model)).toBe(false);
        expect(node.metadata?.model).toBe("platform::muse-image");
    });

    it("preserves an explicitly saved channel that another deployment does not have", () => {
        expect(resolveModelForCapability(platformConfig(defaultConfig), "platform::channel:missing:image", "image")).toBe("platform::channel:missing:image");
    });

    it("respects an available preferred default instead of always selecting the first provider", () => {
        harness.init!.models.image.push({ id: "channel:personal:image", available: true });
        const config = { ...defaultConfig, imageModel: "platform::channel:personal:image" };
        expect(resolveModelForCapability(config, undefined, "image")).toBe("platform::channel:personal:image");
        expect(platformConfig(config).imageModel).toBe("platform::channel:personal:image");
    });

    it("chooses an available video default after a known image-to-video mode switch", () => {
        expect(resolveModelForCapability(defaultConfig, "platform::muse-image", "video")).toBe("platform::muse-service-video");
    });

    it("does not select an image channel that the host marks unavailable", () => {
        harness.init!.models.image = [{ id: "image-channel", available: true, caps: { supportsReferenceImages: true } }];
        expect(resolveModelForCapability(defaultConfig, undefined, "image")).toBe("platform::image-channel");
        harness.init!.models.image[0].available = false;
        expect(resolveModelForCapability(defaultConfig, undefined, "image")).toBe("");
    });

    it("leaves new image configuration empty when only video is available", () => {
        harness.init!.models.image.forEach((model) => { model.available = false; });
        const config = platformConfig(defaultConfig);
        expect(config.imageModel).toBe("");
        expect(config.model).toBe("platform::muse-service-video");
        expect(buildGenerationConfig(config, uploadedImage(), "image").model).toBe("");
    });

    it("does not invent Muse availability before platform initialization", () => {
        harness.init = null;
        expect(platformConfig(defaultConfig)).toMatchObject({ model: "", imageModel: "", videoModel: "", models: [] });
        expect(resolveModelForCapability(defaultConfig, undefined, "image")).toBe("");
    });

    it("rehydrates available defaults before mounting and refreshes them after catalog changes", async () => {
        await initializePlatformConfig(harness.init!);
        expect(useConfigStore.getState().config.imageModel).toBe("platform::muse-service-image");
        harness.init!.models.image = [{ id: "next-image", available: true }];
        for (const listener of harness.listeners) listener(harness.init!);
        expect(useConfigStore.getState().config.imageModel).toBe("platform::next-image");
        expect(useConfigStore.getState().config.channels[0].models.some((model) => model.name === "next-image")).toBe(true);
    });

    it("aborts configuration initialization if project scope changes during hydration", async () => {
        let complete!: () => void;
        vi.spyOn(useConfigStore.persist, "rehydrate").mockImplementation(() => new Promise<void>((resolve) => { complete = resolve; }));
        const original = harness.init!;
        const initializing = initializePlatformConfig(original);
        harness.init = { ...original, scopeId: "other-scope" };
        complete();
        await expect(initializing).rejects.toThrow("不属于当前画布");
    });
});
