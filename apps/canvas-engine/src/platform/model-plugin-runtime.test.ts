import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  if (typeof globalThis.localStorage === "undefined") {
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    });
  }
});

import {
  runModelPlugin,
  type RunPluginArgs,
} from "@/services/api/model-plugin-runtime";
import type { AiConfig } from "@/stores/use-config-store";
import i18n from "@/i18n";

const config = {
  baseUrl: "https://example.test",
  apiKey: "test-key",
  model: "demo",
} as AiConfig;

afterEach(() => vi.useRealTimers());

function args(
  script: string,
  patch: Partial<RunPluginArgs> = {},
): RunPluginArgs {
  return { capability: "text", script, config, ...patch };
}

describe("model plugin runtime", () => {
  it("injects the stable execution context and streams text deltas", async () => {
    const deltas: string[] = [];
    const result = await runModelPlugin(
      args("onDelta(prompt); return { capability, model, apiKey };", {
        prompt: "hello",
        onDelta: (text) => deltas.push(text),
      }),
    );
    expect(result).toEqual({
      capability: "text",
      model: "demo",
      apiKey: "test-key",
    });
    expect(deltas).toEqual(["hello"]);
  });

  it("wraps script failures with the localized execution error", async () => {
    await expect(
      runModelPlugin(args('throw new Error("broken");')),
    ).rejects.toThrow(
      i18n.t("modelPlugin.executionFailed", { message: "broken" }),
    );
  });

  it("preserves cancellation as an AbortError", async () => {
    const controller = new AbortController();
    const pending = runModelPlugin(
      args("await sleep(1000); return 'done';", { signal: controller.signal }),
    );
    const rejection = pending.catch((error: unknown) => error);
    controller.abort();
    expect(await rejection).toMatchObject({ name: "AbortError" });
  });

  it("cancels scripts awaiting their own promises and discards late results", async () => {
    const controller = new AbortController();
    let complete: (value: string) => void = () => undefined;
    const pending = runModelPlugin(
      args("return new Promise(resolve => { params.capture(resolve); });", {
        signal: controller.signal,
        params: {
          capture: (resolve: (value: string) => void) => {
            complete = resolve;
          },
        },
      }),
    );
    const rejection = pending.catch((error: unknown) => error);
    controller.abort();
    expect(await rejection).toMatchObject({ name: "AbortError" });
    complete("late success");
    expect(await rejection).toMatchObject({ name: "AbortError" });
  });

  it("expires polling even when a provider request never resolves", async () => {
    vi.useFakeTimers();
    const pending = runModelPlugin(
      args(
        "return poll(() => new Promise(() => {}), value => value, { timeoutMs: 80 });",
      ),
    );
    let settled = false;
    const rejection = pending.catch((error: unknown) => {
      settled = true;
      return error;
    });
    await vi.advanceTimersByTimeAsync(79);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await rejection).toMatchObject({
      message: i18n.t("modelPlugin.executionFailed", {
        message: i18n.t("modelPlugin.pollTimeout"),
      }),
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels polling while a provider response is pending", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = runModelPlugin(
      args("return poll(() => new Promise(() => {}), value => value);", {
        signal: controller.signal,
      }),
    );
    const rejection = pending.catch((error: unknown) => error);
    controller.abort();
    expect(await rejection).toMatchObject({ name: "AbortError" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports syntax errors through the same localized execution error", async () => {
    const rejection = await runModelPlugin(args("return {")).catch(
      (error: unknown) => error,
    );
    expect(rejection).toBeInstanceOf(Error);
    if (!(rejection instanceof Error)) return;
    const prefix = i18n.t("modelPlugin.executionFailed", { message: "" });
    expect(rejection.message.startsWith(prefix)).toBe(true);
    expect(rejection.message.slice(prefix.length).trim()).not.toBe("");
  });
});
