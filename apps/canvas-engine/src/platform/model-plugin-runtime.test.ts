import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    if (typeof globalThis.localStorage === "undefined") {
        Object.defineProperty(globalThis, "localStorage", { value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined } });
    }
});

import { runModelPlugin, type RunPluginArgs } from "@/services/api/model-plugin-runtime";
import type { AiConfig } from "@/stores/use-config-store";

const config = { baseUrl: "https://example.test", apiKey: "test-key", model: "demo" } as AiConfig;

function args(script: string, patch: Partial<RunPluginArgs> = {}): RunPluginArgs {
    return { capability: "text", script, config, ...patch };
}

describe("model plugin runtime", () => {
    it("injects the stable execution context and streams text deltas", async () => {
        const deltas: string[] = [];
        const result = await runModelPlugin(args("onDelta(prompt); return { capability, model, apiKey };", { prompt: "hello", onDelta: (text) => deltas.push(text) }));
        expect(result).toEqual({ capability: "text", model: "demo", apiKey: "test-key" });
        expect(deltas).toEqual(["hello"]);
    });

    it("wraps script failures with the localized execution error", async () => {
        await expect(runModelPlugin(args('throw new Error("broken");'))).rejects.toThrow(/模型调用脚本执行失败|Model plugin execution failed/);
    });

    it("preserves cancellation as an AbortError", async () => {
        const controller = new AbortController();
        const pending = runModelPlugin(args("await sleep(1000); return 'done';", { signal: controller.signal }));
        controller.abort();
        await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    });
});
