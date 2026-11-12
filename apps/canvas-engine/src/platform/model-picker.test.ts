import { describe, expect, it } from "vitest";

import {
  getModelIconPath,
  getModelPickerEmptyState,
  getModelPickerLabel,
  getModelPickerOptions,
} from "@/lib/model-picker";
import { defaultConfig } from "@/stores/use-config-store";

const config = {
  ...defaultConfig,
  models: ["local::vision", "remote::writer"],
  channels: [
    {
      ...defaultConfig.channels[0],
      id: "local",
      name: "本地视觉",
      models: [
        { name: "vision", capability: "image" as const },
        { name: "movie", capability: "video" as const },
      ],
    },
    {
      ...defaultConfig.channels[0],
      id: "remote",
      name: "文字服务",
      models: [{ name: "writer", capability: "text" as const }],
    },
  ],
};

describe("model picker catalog", () => {
  it("filters by capability and keeps an unlisted local default visible", () => {
    expect(getModelPickerOptions(config, "legacy::image", "image")).toEqual([
      "local::vision",
    ]);
    expect(getModelPickerOptions(config, "legacy::image")).toEqual([
      "legacy::image",
      "local::vision",
      "remote::writer",
    ]);
  });

  it("does not inject a current value into a remote channel catalog", () => {
    const remoteConfig = { ...config, channelMode: "remote" as const };
    expect(getModelPickerOptions(remoteConfig, "not-configured")).toEqual([
      "local::vision",
      "remote::writer",
    ]);
  });

  it("provides capability-aware empty states and channel-qualified labels", () => {
    expect(getModelPickerEmptyState(config, "audio")).toEqual({
      key: "settingsPanels.model.assign",
      values: { capability: "settingsPanels.model.capabilities.audio" },
    });
    expect(
      getModelPickerEmptyState({ ...config, models: [] }, "audio"),
    ).toEqual({ key: "settingsPanels.model.addFirst" });
    expect(getModelPickerLabel(config, "remote::writer")).toBe(
      "writer（文字服务）",
    );
  });

  it("resolves icons from canonical model names", () => {
    expect(getModelIconPath("platform::claude-3")).toBe("/icons/claude.svg");
    expect(getModelIconPath("openai-gpt-4o")).toBe("/icons/openai.svg");
    expect(getModelIconPath("other-model")).toBe("");
  });
});
