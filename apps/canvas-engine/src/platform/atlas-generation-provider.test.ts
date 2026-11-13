import { describe, expect, it, vi } from "vitest";

import type { AtlasGenerationEvent } from "@/atlas-engine/workflows/generation-events";
import { executeAtlasProvider, type AtlasProviderPorts } from "@/atlas-engine/workflows/generation-provider";
import { applyAtlasGenerationEvent } from "@/atlas-engine/workflows/generation-state";
import { buildNodeGenerationContext } from "@/atlas-engine/workflows/node-generation-context";
import { applyAtlasNodeOutputPlan, planAtlasNodeOutput } from "@/atlas-engine/workflows/node-output";
import { defaultConfig } from "@/stores/use-config-store";
import type { CanvasGenerationMode } from "@/types/canvas";

function fixture(mode: CanvasGenerationMode) {
  let sequence = 0;
  const context = buildNodeGenerationContext("source", [], [], "  Preserve continuity  ");
  const plan = planAtlasNodeOutput({
    mode,
    sourceId: "source",
    prompt: context.prompt.trim(),
    sourcePrompt: context.prompt,
    config: defaultConfig,
    overwriteExisting: false,
    imageCount: 2,
    textCount: 2,
    references: [],
    referenceUrls: [],
    createId: () => `result-${++sequence}`,
  });
  const signal = new AbortController().signal;
  const events: AtlasGenerationEvent[] = [];
  let nodes = applyAtlasNodeOutputPlan([], plan);
  const uploadedImage = { url: "/image.png", storageKey: "image-key", width: 960, height: 540, bytes: 12, mimeType: "image/png" };
  const uploadedAudio = { url: "/voice.mp3", storageKey: "audio-key", bytes: 10, mimeType: "audio/mpeg" };
  const ports: AtlasProviderPorts = {
    image: {
      generate: vi.fn(async () => [{ id: "provider-image", dataUrl: "data:image/png;base64,AA==" }]),
      edit: vi.fn(async () => []),
      upload: vi.fn(async () => uploadedImage),
      isCancelled: (error) => error instanceof Error && error.name === "AbortError",
    },
    text: {
      request: vi.fn(async () => "Generated paragraph"),
      isCancelled: (error) => error instanceof Error && error.name === "AbortError",
    },
    audio: {
      generate: vi.fn(async () => new Blob(["voice"])),
      store: vi.fn(async () => uploadedAudio),
    },
    video: vi.fn(async () => {}),
  };

  return {
    plan,
    context,
    ports,
    signal,
    events,
    uploadedImage,
    uploadedAudio,
    nodes: () => nodes,
    emit: (event: AtlasGenerationEvent) => {
      events.push(event);
      nodes = applyAtlasGenerationEvent(nodes, plan.output.outputId, event);
    },
    errorText: (error: unknown) => error instanceof Error ? error.message : "Generation failed",
  };
}

describe("Atlas provider execution", () => {
  it("commits stored images and preserves successful variants when a sibling request fails", async () => {
    const run = fixture("image");
    let count = 0;
    run.ports.image.generate = vi.fn(async () => {
      if (++count === 2) throw new Error("Provider quota exhausted");
      return [{ id: "provider-image", dataUrl: "image-data" }];
    });

    const result = await executeAtlasProvider({ ...run, config: defaultConfig });

    expect(result).toMatchObject({ kind: "images", summary: { succeeded: 1, failed: 1, isPartial: true }, firstError: "Provider quota exhausted" });
    expect(run.events.map((event) => event.type).sort()).toEqual(["image-failed", "image-stored"]);
    expect(run.nodes()[0].metadata).toMatchObject({ content: "/image.png", storageKey: "image-key", naturalWidth: 960, naturalHeight: 540 });
    expect(run.nodes()[0].metadata?.images).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "success", content: "/image.png" }),
      expect.objectContaining({ status: "error", errorDetails: "Provider quota exhausted" }),
    ]));
  });

  it("publishes text streams and keeps successful and failed results separate", async () => {
    const run = fixture("text");
    let count = 0;
    run.ports.text.request = vi.fn(async (_config, _messages, onStream) => {
      if (++count === 2) throw new Error("Text provider rejected this variant");
      onStream?.("Partial paragraph");
      return "Completed paragraph";
    });

    const result = await executeAtlasProvider({ ...run, config: defaultConfig });

    expect(result).toMatchObject({ kind: "texts", completed: [{ status: "success", content: "Completed paragraph" }], failed: [{ status: "error", errorDetails: "Text provider rejected this variant" }] });
    expect(run.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "text-patch", patch: { content: "Partial paragraph" } }),
      expect.objectContaining({ type: "text-patch", patch: { content: "Completed paragraph", status: "success" } }),
    ]));
    expect(run.nodes()[0].metadata?.content).toBe("Completed paragraph");
  });

  it("stores the audio prompt, voice and format with the generated media", async () => {
    const run = fixture("audio");
    const config = { ...defaultConfig, model: "voice-model", audioVoice: "nova", audioFormat: "wav", audioSpeed: "1.2", audioInstructions: "Warm narration" };

    await executeAtlasProvider({ ...run, config });

    expect(run.ports.audio.generate).toHaveBeenCalledWith(config, "Preserve continuity", { signal: run.signal });
    expect(run.nodes()[0].metadata).toMatchObject({
      content: "/voice.mp3",
      prompt: "Preserve continuity",
      model: "voice-model",
      audioVoice: "nova",
      audioFormat: "wav",
      audioSpeed: "1.2",
      audioInstructions: "Warm narration",
    });
  });

  it("passes video execution the same hydrated reference context and cancellation signal", async () => {
    const run = fixture("video");
    const result = await executeAtlasProvider({ ...run, config: defaultConfig });

    expect(result).toEqual({ kind: "media", mode: "video" });
    expect(run.ports.video).toHaveBeenCalledWith({ outputId: run.plan.output.outputId, config: defaultConfig, prompt: "Preserve continuity", context: run.context, signal: run.signal });
    expect(run.events).toHaveLength(0);
  });

  it("does not submit any provider request after the run has been cancelled", async () => {
    const run = fixture("video");
    const controller = new AbortController();
    controller.abort();

    await expect(executeAtlasProvider({ ...run, signal: controller.signal, config: defaultConfig })).rejects.toMatchObject({ name: "AbortError" });
    expect(run.ports.video).not.toHaveBeenCalled();
    expect(run.events).toHaveLength(0);
  });

  it("ignores an audio provider response that arrives after cancellation", async () => {
    const run = fixture("audio");
    const controller = new AbortController();
    run.ports.audio.generate = vi.fn(async () => {
      controller.abort();
      return new Blob(["late voice"]);
    });

    await expect(executeAtlasProvider({ ...run, signal: controller.signal, config: defaultConfig })).rejects.toMatchObject({ name: "AbortError" });
    expect(run.ports.audio.store).not.toHaveBeenCalled();
    expect(run.events).toHaveLength(0);
  });
});
