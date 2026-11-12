import axios from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getPluginTemplates } from "@/services/api/model-plugin-templates";
import { runModelPlugin } from "@/services/api/model-plugin-runtime";
import type { AiConfig, ModelCapability } from "@/stores/use-config-store";

const config = {
  baseUrl: "https://provider.example",
  apiKey: "test-key",
  model: "demo-model",
} as AiConfig;

const pluginArgs = (
  capability: ModelCapability,
  index: number,
  patch: Record<string, unknown> = {},
) => ({
  capability,
  config,
  script: getPluginTemplates()[capability][index].script,
  ...patch,
});

describe("built-in model scripts", () => {
  afterEach(() => vi.restoreAllMocks());

  it("provides two executable templates for each supported capability", () => {
    const templates = getPluginTemplates();
    expect(Object.keys(templates).sort()).toEqual([
      "audio",
      "image",
      "text",
      "video",
    ]);

    for (const entries of Object.values(templates)) {
      expect(entries).toHaveLength(2);
      for (const template of entries) {
        expect(
          () => new Function(`return (async () => {\n${template.script}\n})`),
        ).not.toThrow();
      }
    }
  });

  it("returns generated image data from the OpenAI-compatible endpoint", async () => {
    vi.spyOn(axios, "request").mockResolvedValue({
      data: { data: [{ b64_json: "abc" }] },
    } as never);

    await expect(
      runModelPlugin(pluginArgs("image", 0, { prompt: "a red kite" })),
    ).resolves.toEqual(["data:image/png;base64,abc"]);
  });

  it("extracts Gemini text and sends the result to the stream callback", async () => {
    vi.spyOn(axios, "request").mockResolvedValue({
      data: {
        candidates: [{ content: { parts: [{ text: "A clear answer" }] } }],
      },
    } as never);
    const onDelta = vi.fn();

    await expect(
      runModelPlugin(
        pluginArgs("text", 1, {
          messages: [{ role: "user", content: "Explain this" }],
          onDelta,
        }),
      ),
    ).resolves.toBe("A clear answer");
    expect(onDelta).toHaveBeenCalledWith("A clear answer");
  });

  it("polls a completed OpenAI-compatible video task and returns its media", async () => {
    const media = new Blob(["video"]);
    vi.spyOn(axios, "request")
      .mockResolvedValueOnce({ data: { id: "task-7" } } as never)
      .mockResolvedValueOnce({ data: { status: "completed" } } as never)
      .mockResolvedValueOnce({ data: media } as never);

    await expect(
      runModelPlugin(pluginArgs("video", 0, { prompt: "A kite in the wind" })),
    ).resolves.toBe(media);
  });
});
