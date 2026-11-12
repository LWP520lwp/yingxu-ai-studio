import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchOfficialPlugins, hasUpgrade } from "@/lib/canvas/plugin-registry";

vi.mock("@/constant/env", () => ({ PLUGIN_REGISTRY_URL: "https://plugins.example/registry.json" }));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));

afterEach(() => vi.unstubAllGlobals());

describe("official plugin registry", () => {
    it("resolves relative entries and ignores malformed and duplicate entries", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
            plugins: [
                { id: " demo ", entry: "./dist/demo.js", name: " Demo " },
                { id: "demo", url: "https://other.example/replacement.js" },
                { id: "bad-scheme", url: "javascript:alert(1)" },
                { id: "missing-url" },
                null,
            ],
        }), { status: 200 })));

        await expect(fetchOfficialPlugins()).resolves.toEqual([
            { id: "demo", name: "Demo", version: "0.0.0", description: undefined, icon: undefined, url: "https://plugins.example/dist/demo.js" },
        ]);
    });

    it("rejects a malformed registry URL and invalid JSON", async () => {
        await expect(fetchOfficialPlugins("javascript:alert(1)")).rejects.toThrow();
        vi.stubGlobal("fetch", vi.fn(async () => new Response("not-json", { status: 200 })));
        await expect(fetchOfficialPlugins()).rejects.toThrow("canvas.pluginErrors.registryFailed");
    });

    it("keeps the existing numeric three-part upgrade comparison", () => {
        expect(hasUpgrade("1.2.3", "1.2.4")).toBe(true);
        expect(hasUpgrade("1.2.3", "1.2.3-beta.1")).toBe(false);
        expect(hasUpgrade("2.0.0", "1.99.99")).toBe(false);
    });
});
