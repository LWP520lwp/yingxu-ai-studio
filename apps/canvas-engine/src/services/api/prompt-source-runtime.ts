import i18n from "@/i18n";
import type { PromptSource } from "./prompt-source-presets";

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

type RunOptions = { signal?: AbortSignal };
type JsonRecord = Record<string, unknown>;

const scalar = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";
const optionalText = (value: unknown): string | undefined =>
  scalar(value).trim() || undefined;

function listOfText(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const item = scalar(entry).trim();
    return item ? [item] : [];
  });
}

function resolveResource(base: string, value: unknown): string {
  const path = scalar(value);
  if (!path) return "";
  try {
    return new URL(path, base).href;
  } catch {
    return path;
  }
}

function readCount(value: unknown): number | undefined {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? count : undefined;
}

function convertRecord(
  record: JsonRecord,
  source: PromptSource,
  position: number,
): RawPrompt | null {
  const title = scalar(record.title).trim();
  const prompt = scalar(record.prompt).trim();
  if (!title || !prompt) return null;

  const referenceImageUrls = listOfText(record.referenceImageUrls).map((url) =>
    resolveResource(source.url, url),
  );
  return {
    id:
      scalar(record.id).trim() ||
      `${source.id}-${String(position + 1).padStart(4, "0")}`,
    title,
    prompt,
    description: scalar(record.description),
    coverUrl:
      resolveResource(source.url, record.coverUrl) ||
      referenceImageUrls[0] ||
      "",
    referenceImageUrls,
    tags: listOfText(record.tags),
    preview: scalar(record.preview),
    createdAt: scalar(record.createdAt),
    updatedAt: scalar(record.updatedAt),
    author: scalar(record.author),
    sourceUrl: resolveResource(source.url, record.sourceUrl),
    imageMode: optionalText(record.imageMode),
    imageModel: optionalText(record.imageModel),
    imageSize: optionalText(record.imageSize),
    imageCount: readCount(record.imageCount),
  };
}

/** Keep the first valid row for each source-local id. */
export function decodePromptSource(
  data: unknown,
  source: PromptSource,
): RawPrompt[] {
  if (!Array.isArray(data)) {
    throw new Error(
      i18n.t("config.promptSources.runtime.invalidRoot", {
        name: source.name,
      }),
    );
  }

  const byId = new Map<string, RawPrompt>();
  data.forEach((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const prompt = convertRecord(value as JsonRecord, source, index);
    if (prompt && !byId.has(prompt.id)) byId.set(prompt.id, prompt);
  });
  return [...byId.values()];
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw (
      signal.reason ??
      new DOMException("The operation was aborted", "AbortError")
    );
  }
}

function isAbort(error: unknown, signal?: AbortSignal) {
  return (
    Boolean(signal?.aborted) ||
    Boolean(
      error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "AbortError",
    )
  );
}

export async function runPromptSource(
  source: PromptSource,
  options: RunOptions = {},
): Promise<RawPrompt[]> {
  throwIfAborted(options.signal);
  if (!source.url.trim()) {
    throw new Error(i18n.t("config.promptSources.runtime.urlRequired"));
  }

  let json: unknown;
  try {
    const response = await fetch(source.url, {
      cache: "no-store",
      signal: options.signal,
    });
    if (!response.ok) {
      throw new Error(
        i18n.t("config.promptSources.runtime.requestFailed", {
          status: response.status,
        }),
      );
    }
    json = await response.json();
    throwIfAborted(options.signal);
  } catch (error) {
    if (isAbort(error, options.signal)) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      i18n.t("config.promptSources.runtime.fetchFailed", {
        name: source.name,
        error: detail,
      }),
    );
  }

  const prompts = decodePromptSource(json, source);
  if (source.builtIn && prompts.length === 0) {
    throw new Error(
      i18n.t("config.promptSources.runtime.noPrompts", { name: source.name }),
    );
  }
  return prompts;
}
