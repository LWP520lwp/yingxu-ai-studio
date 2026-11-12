export type ApiCallFormat = "openai" | "gemini";
export type ModelCapability = "image" | "video" | "text" | "audio";
export type ReasoningEffort = "auto" | "low" | "medium" | "high" | "xhigh";

export type ChannelModel = {
  name: string;
  capability: ModelCapability;
  script?: string;
};

export type ModelChannel = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  apiFormat: ApiCallFormat;
  models: ChannelModel[];
};

export type ProviderAccessConfig = {
  channelMode: "remote" | "local";
  baseUrl: string;
  apiKey: string;
  apiFormat: ApiCallFormat;
  channels: ModelChannel[];
};

export type CapabilityModelConfig = {
  model: string;
  imageModel: string;
  videoModel: string;
  textModel: string;
  audioModel: string;
  models: string[];
};

export type AudioGenerationConfig = {
  audioVoice: string;
  audioFormat: string;
  audioSpeed: string;
  audioInstructions: string;
};

export type VideoGenerationConfig = {
  videoSeconds: string;
  vquality: string;
  videoGenerateAudio: string;
  videoWatermark: string;
  videoMode: string;
  videoFramesReversed?: boolean;
};

export type SkillApplicationConfig = {
  videoSkillId?: string;
  videoSkillVersion?: string;
  appliedSkillId?: string;
  appliedSkillVersion?: string;
  videoSkillReviewRequired?: boolean;
};

export type TextGenerationConfig = {
  systemPrompt: string;
  reasoningEffort: ReasoningEffort;
};

export type ImageGenerationConfig = {
  quality: string;
  size: string;
  background: string;
  count: string;
  canvasImageCount: string;
};

export type ProxyConfig = {
  proxyEnabled: boolean;
  proxyUrl: string;
};

export type CanvasBehaviorConfig = {
  nodeRegenerateBehavior: "new-node" | "overwrite";
  autoFocusOnSelect: boolean;
};

export type AiConfig =
  & ProviderAccessConfig
  & CapabilityModelConfig
  & AudioGenerationConfig
  & VideoGenerationConfig
  & SkillApplicationConfig
  & TextGenerationConfig
  & ImageGenerationConfig
  & ProxyConfig
  & CanvasBehaviorConfig;

export type WebdavSyncConfig = {
  url: string;
  username: string;
  password: string;
  directory: string;
  lastSyncedAt: string;
};
export type ConfigTabKey =
  | "channels"
  | "local-proxy"
  | "preferences"
  | "prompt-sources"
  | "webdav"
  | "local-storage";

export type ChannelCredentialsImportResult = {
  status: "created" | "updated" | "missing-base-url" | "invalid-base-url";
  channelName?: string;
};
