import type {
  AiConfig,
  AudioGenerationConfig,
  ImageGenerationConfig,
  TextGenerationConfig,
  VideoGenerationConfig,
  WebdavSyncConfig,
} from "./types";

export const CONFIG_STORE_KEY = "frameflow:canvas:ai_config_store:v1";
export const DEFAULT_LOCAL_PROXY_URL = "http://127.0.0.1:23210";

const initialGeneration = {
  image: {
    size: "1:1",
    quality: "auto",
    count: "1",
    canvasImageCount: "1",
    background: "",
  } satisfies ImageGenerationConfig,
  video: {
    videoMode: "reference",
    videoSeconds: "6",
    vquality: "720",
    videoGenerateAudio: "auto",
    videoWatermark: "auto",
  } satisfies VideoGenerationConfig,
  audio: {
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
  } satisfies AudioGenerationConfig,
  text: {
    systemPrompt: "",
    reasoningEffort: "auto",
  } satisfies TextGenerationConfig,
};

/** Each caller owns its arrays and channel records, including nested models. */
export function createDefaultConfig(): AiConfig {
  return {
    ...initialGeneration.image,
    ...initialGeneration.video,
    ...initialGeneration.audio,
    ...initialGeneration.text,
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
    models: ["platform::muse-image", "platform::muse-video"],
    proxyEnabled: false,
    proxyUrl: DEFAULT_LOCAL_PROXY_URL,
    nodeRegenerateBehavior: "new-node",
    autoFocusOnSelect: false,
  };
}

export const defaultConfig: AiConfig = createDefaultConfig();

export const defaultWebdavSyncConfig: WebdavSyncConfig = {
  url: "",
  username: "",
  password: "",
  directory: "yingxu-ai-studio",
  lastSyncedAt: "",
};
