export type RawPrompt = {
  id: string;
  title: string;
  prompt: string;
  description: string;
  coverUrl: string;
  referenceImageUrls: string[];
  tags: string[];
  preview: string;
  createdAt: string;
  updatedAt: string;
  author?: string;
  sourceUrl?: string;
  imageMode?: string;
  imageModel?: string;
  imageSize?: string;
  imageCount?: number;
};

export type Prompt = RawPrompt & {
  sourceId: string;
  category: string;
  githubUrl: string;
};

export type PromptListResponse = {
  items: Prompt[];
  tags: string[];
  categories: string[];
  total: number;
};

export type PromptSourceStatus = {
  sourceId: string;
  count: number;
  lastSuccessAt: string;
  lastError: string;
};

export type PromptSourceRefreshResult = PromptSourceStatus & {
  sourceName: string;
  success: boolean;
};

export type PromptSourceRefreshSummary = {
  results: PromptSourceRefreshResult[];
  total: number;
  successCount: number;
  failureCount: number;
};
