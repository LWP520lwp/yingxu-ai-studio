import type { AiConfig, WebdavSyncConfig } from "./types";

export const CONFIG_STORE_KEY = "frameflow:canvas:ai_config_store:v1";
export const DEFAULT_LOCAL_PROXY_URL = "http://127.0.0.1:23210";

export const defaultConfig: AiConfig = {
  channelMode: "local",
  baseUrl: "",
  apiKey: "",
  apiFormat: "openai",
  channels: [
    {
      id: "platform",
      name: "映序平台账号池",
      baseUrl: "",
      apiKey: "",
      apiFormat: "openai",
      models: [
        { name: "muse-image", capability: "image" },
        { name: "muse-video", capability: "video" },
      ],
    },
  ],
  model: "platform::muse-image",
  imageModel: "platform::muse-image",
  videoModel: "platform::muse-video",
  textModel: "",
  audioModel: "",
  audioVoice: "alloy",
  audioFormat: "mp3",
  audioSpeed: "1",
  audioInstructions: "",
  videoSeconds: "6",
  vquality: "720",
  videoGenerateAudio: "auto",
  videoWatermark: "auto",
  videoMode: "reference",
  systemPrompt: "",
  reasoningEffort: "auto",
  models: ["platform::muse-image", "platform::muse-video"],
  quality: "auto",
  size: "1:1",
  background: "",
  count: "1",
  canvasImageCount: "1",
  proxyEnabled: false,
  proxyUrl: DEFAULT_LOCAL_PROXY_URL,
  nodeRegenerateBehavior: "new-node",
  autoFocusOnSelect: false,
};

export const defaultWebdavSyncConfig: WebdavSyncConfig = {
  url: "",
  username: "",
  password: "",
  directory: "yingxu-ai-studio",
  lastSyncedAt: "",
};
