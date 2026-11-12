import i18n from "@/i18n";
import type { RawPrompt } from "@/types/prompts";
import type { PromptSource } from "./prompt-source-presets";
export type { RawPrompt } from "@/types/prompts";

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

function extractPromptRecords(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const envelope = data as Record<string, unknown>;
  for (const key of ["prompts", "items", "data", "skills"]) {
    if (Array.isArray(envelope[key])) return envelope[key] as unknown[];
  }
  return [];
}

/** Accept plain lists and common registry envelopes while keeping first IDs. */
export function decodePromptSource(
  data: unknown,
  source: PromptSource,
): RawPrompt[] {
  const records = extractPromptRecords(data);
  if (!Array.isArray(data) && (!data || typeof data !== "object")) {
    throw new Error(
      i18n.t("config.promptSources.runtime.invalidRoot", {
        name: source.name,
      }),
    );
  }
  if (!Array.isArray(data) && records.length === 0) {
    throw new Error(
      i18n.t("config.promptSources.runtime.invalidRoot", {
        name: source.name,
      }),
    );
  }

  const byId = new Map<string, RawPrompt>();
  records.forEach((value, index) => {
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
