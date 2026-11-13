import { describe, expect, it, vi } from "vitest";

import { generateAtlasAudio } from "@/atlas-engine/workflows/audio-generation";
import type { AiConfig } from "@/stores/use-config-store";

const config = { audioFormat: "mp3" } as AiConfig;

describe("generateAtlasAudio", () => {
  it("passes cancellation through generation and stores before publishing", async () => {
    const signal = new AbortController().signal;
    const result = new Blob(["audio"]);
    const audio = {
      url: "/voice.mp3",
      storageKey: "voice-key",
      bytes: 5,
      mimeType: "audio/mpeg",
    };
    const generate = vi.fn(async () => result);
    const store = vi.fn(async () => audio);
    const onAudio = vi.fn();

    await generateAtlasAudio({
      config,
      prompt: "Narrate this line",
      signal,
      ports: { generate, store },
      onAudio,
    });

    expect(generate).toHaveBeenCalledWith(config, "Narrate this line", {
      signal,
    });
    expect(store).toHaveBeenCalledWith(result, "mp3");
    expect(onAudio).toHaveBeenCalledWith(audio);
    expect(generate.mock.invocationCallOrder[0]).toBeLessThan(
      store.mock.invocationCallOrder[0],
    );
    expect(store.mock.invocationCallOrder[0]).toBeLessThan(
      onAudio.mock.invocationCallOrder[0],
    );
  });

  it("leaves failure handling to the caller and does not publish failed output", async () => {
    const failure = new Error("audio provider failed");
    const onAudio = vi.fn();

    await expect(
      generateAtlasAudio({
        config,
        prompt: "Narrate this line",
        signal: new AbortController().signal,
        ports: {
          generate: vi.fn(async () => {
            throw failure;
          }) as never,
          store: vi.fn() as never,
        },
        onAudio,
      }),
    ).rejects.toBe(failure);

    expect(onAudio).not.toHaveBeenCalled();
  });

  it("does not store or publish a late response after cancellation", async () => {
    const controller = new AbortController();
    const store = vi.fn();
    const onAudio = vi.fn();
    await expect(
      generateAtlasAudio({
        config,
        prompt: "cancelled narration",
        signal: controller.signal,
        ports: {
          generate: vi.fn(async () => {
            controller.abort();
            return new Blob(["late response"]);
          }),
          store,
        },
        onAudio,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(store).not.toHaveBeenCalled();
    expect(onAudio).not.toHaveBeenCalled();
  });
});
