import axios, { type AxiosRequestConfig } from "axios";

import i18n from "@/i18n";
import {
  buildApiUrl,
  withLocalProxy,
  type AiConfig,
  type ModelCapability,
} from "@/stores/use-config-store";

type RequestOptions = { signal?: AbortSignal };

export type PluginHttpOptions = {
  headers?: Record<string, string>;
  params?: Record<string, unknown>;
  responseType?: "json" | "blob" | "text" | "arraybuffer";
};

export type PluginHttp = {
  url: (path: string) => string;
  post: (
    path: string,
    body?: unknown,
    options?: PluginHttpOptions,
  ) => Promise<unknown>;
  get: (path: string, options?: PluginHttpOptions) => Promise<unknown>;
};

export type PluginPollOptions = { intervalMs?: number; timeoutMs?: number };

type PluginMedia = {
  images: string[];
  videos: File[];
  audios: File[];
};

export type RunPluginArgs = Partial<PluginMedia> & {
  capability: ModelCapability;
  script: string;
  config: AiConfig;
  prompt?: string;
  messages?: unknown[];
  params?: Record<string, unknown>;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
};

type PluginRequest = AxiosRequestConfig & { url: string };

function createAbortError() {
  if (typeof DOMException !== "undefined") {
    return new DOMException("The model request was cancelled", "AbortError");
  }
  const error = new Error("The model request was cancelled");
  error.name = "AbortError";
  return error;
}

function assertActive(signal?: AbortSignal) {
  if (signal?.aborted) throw createAbortError();
}

function resolvePluginUrl(config: AiConfig, input: string) {
  if (/^https?:\/\//i.test(input)) return withLocalProxy(input);
  return buildApiUrl(
    config.baseUrl,
    input.startsWith("/") ? input : `/${input}`,
  );
}

function withJsonHeader(
  headers: Record<string, string>,
  body: unknown,
  enabled: boolean,
) {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  if (
    enabled &&
    body !== undefined &&
    !isForm &&
    !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")
  ) {
    return { ...headers, "Content-Type": "application/json" };
  }
  return headers;
}

function createRequestEnvironment(
  config: AiConfig,
  { signal }: RequestOptions = {},
) {
  const send = async (
    options: PluginRequest,
    authenticated: boolean,
    inferJson = false,
  ) => {
    assertActive(signal);
    const sourceHeaders = (options.headers || {}) as Record<string, string>;
    const headers = authenticated
      ? { Authorization: `Bearer ${config.apiKey}`, ...sourceHeaders }
      : sourceHeaders;
    const response = await axios.request({
      ...options,
      url: resolvePluginUrl(config, options.url),
      headers: withJsonHeader(headers, options.data, inferJson),
      signal,
    });
    return response.data;
  };

  const request = (options: PluginRequest) => send(options, false);
  const http: PluginHttp = {
    url: (path) => resolvePluginUrl(config, path),
    get: (path, options) =>
      send(
        {
          method: "get",
          url: path,
          params: options?.params,
          responseType: options?.responseType || "json",
          headers: options?.headers,
        },
        true,
      ),
    post: (path, body, options) =>
      send(
        {
          method: "post",
          url: path,
          data: body,
          params: options?.params,
          responseType: options?.responseType || "json",
          headers: options?.headers,
        },
        true,
        true,
      ),
  };

  return { http, request };
}

function waitForNextPoll(intervalMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    assertActive(signal);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    }, intervalMs);
    const cancel = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      reject(createAbortError());
    };
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

function createPoller(signal?: AbortSignal) {
  return async function poll<T, Result>(
    request: () => Promise<T>,
    resolveResult: (value: T) => Result | null | undefined | false,
    options: PluginPollOptions = {},
  ): Promise<Result> {
    const interval = Math.max(1, options.intervalMs ?? 2500);
    const deadline = Date.now() + Math.max(1, options.timeoutMs ?? 300_000);

    while (true) {
      assertActive(signal);
      const value = await readBeforeDeadline(request, deadline, signal);
      assertActive(signal);
      const result = resolveResult(value);
      if (result !== null && result !== undefined && result !== false)
        return result;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(i18n.t("modelPlugin.pollTimeout"));
      await waitForNextPoll(Math.min(interval, remaining), signal);
    }
  };
}

function readBeforeDeadline<T>(read: () => Promise<T>, deadline: number, signal?: AbortSignal) {
  assertActive(signal);
  let timer: ReturnType<typeof setTimeout>;
  let cancel: () => void;
  const interrupted = new Promise<never>((_resolve, reject) => {
    cancel = () => reject(createAbortError());
    timer = setTimeout(() => reject(new Error(i18n.t("modelPlugin.pollTimeout"))), Math.max(0, deadline - Date.now()));
    signal?.addEventListener("abort", cancel, { once: true });
  });
  const reading = Promise.resolve().then(() => {
    assertActive(signal);
    return read();
  });
  return Promise.race([reading, interrupted]).finally(() => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  });
}

function normalizePluginFailure(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") return error;
  if (axios.isCancel(error)) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(i18n.t("modelPlugin.executionFailed", { message: detail }));
}

/** Run a user-configured script with the canvas model context and request helpers. */
export async function runModelPlugin<T = unknown>(
  args: RunPluginArgs,
): Promise<T> {
  const { config, signal } = args;
  const { http, request } = createRequestEnvironment(config, { signal });
  const bindings = {
    prompt: args.prompt ?? "",
    images: args.images ?? [],
    videos: args.videos ?? [],
    audios: args.audios ?? [],
    messages: args.messages ?? [],
    params: args.params ?? {},
    model: config.model,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    systemPrompt: config.systemPrompt ?? "",
    reasoningEffort: config.reasoningEffort,
    http,
    request,
    poll: createPoller(signal),
    sleep: (ms: number) => waitForNextPoll(Math.max(1, ms), signal),
    signal,
    onDelta: args.onDelta,
    capability: args.capability,
  };
  try {
    assertActive(signal);
    const execute = new Function(
      ...Object.keys(bindings),
      `"use strict"; return (async () => {\n${args.script}\n})();`,
    ) as (...values: unknown[]) => Promise<T>;
    return await execute(...Object.values(bindings));
  } catch (error) {
    throw normalizePluginFailure(error);
  }
}
