import i18n from "@/i18n";
import {
  withLocalProxy,
  type WebdavSyncConfig,
} from "@/stores/use-config-store";
import { abortReason } from "@/services/media-storage-runtime";

export const WEBDAV_MANIFEST_FILE_NAME = "manifest.json";
const WEBDAV_REQUEST_TIMEOUT_MS = 120_000;
const ensuredDirectories = new Set<string>();
type DirectoryRequest = {
  controller: AbortController;
  promise: Promise<void>;
  waiters: number;
  settled: boolean;
};
const directoryRequests = new Map<string, DirectoryRequest>();
const webdavText = (key: string, options?: Record<string, unknown>) =>
  i18n.t(`config.webdav.errors.${key}`, options);

export async function testWebdavConnection(
  config: WebdavSyncConfig,
  signal?: AbortSignal,
) {
  await ensureWebdavDirectory(config, signal);
  const response = await webdavFetch(
    config,
    "",
    { method: "PROPFIND", headers: { Depth: "0" } },
    signal,
  );
  if (response.ok || response.status === 207) {
    void response.body?.cancel().catch(() => undefined);
    return;
  }
  await throwWebdavError(response, webdavText("testFailed"), signal);
}

export async function downloadWebdavSyncFile(
  config: WebdavSyncConfig,
  signal?: AbortSignal,
) {
  return downloadWebdavFile(config, WEBDAV_MANIFEST_FILE_NAME, signal);
}

export async function downloadWebdavFile(
  config: WebdavSyncConfig,
  path: string,
  signal?: AbortSignal,
) {
  const normalizedPath = normalizePath(path);
  await ensureWebdavDirectory(config, signal);
  const response = await webdavFetch(
    config,
    normalizedPath,
    { method: "GET" },
    signal,
  );
  if (response.status === 404) {
    void response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.ok) {
    await throwWebdavError(response, webdavText("downloadFailed"), signal);
  }
  const file = await consumeResponseBody(
    () => response.blob(),
    response,
    signal,
    webdavText("downloadTimeout"),
  );
  return file.size ? file : null;
}

export async function uploadWebdavSyncFile(
  config: WebdavSyncConfig,
  file: Blob,
  signal?: AbortSignal,
) {
  return uploadWebdavFile(
    config,
    WEBDAV_MANIFEST_FILE_NAME,
    file,
    "application/json",
    signal,
  );
}

export async function uploadWebdavFile(
  config: WebdavSyncConfig,
  path: string,
  file: Blob,
  contentType = "application/octet-stream",
  signal?: AbortSignal,
) {
  if (!file.size) throw new Error(webdavText("emptyUpload"));
  const normalizedPath = normalizePath(path);
  await ensureWebdavDirectory(config, signal);
  await ensureWebdavSubdirectory(config, normalizedPath, signal);
  const response = await webdavFetch(
    config,
    normalizedPath,
    {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: file,
    },
    signal,
  );
  if (!response.ok) {
    await throwWebdavError(response, webdavText("uploadFailed"), signal);
  }
  void response.body?.cancel().catch(() => undefined);
}

async function ensureWebdavDirectory(
  config: WebdavSyncConfig,
  signal?: AbortSignal,
) {
  assertWebdavConfig(config);
  await ensureWebdavDirectoryPath(config, config.directory, signal);
}

async function ensureWebdavSubdirectory(
  config: WebdavSyncConfig,
  path: string,
  signal?: AbortSignal,
) {
  const directory = normalizePath(path).split("/").slice(0, -1).join("/");
  if (!directory) return;
  await ensureWebdavDirectoryPath(
    config,
    [config.directory, directory].filter(Boolean).join("/"),
    signal,
  );
}

function ensureWebdavDirectoryPath(
  config: WebdavSyncConfig,
  directory: string,
  signal?: AbortSignal,
) {
  const parts = normalizePath(directory).split("/").filter(Boolean);
  if (!parts.length) return Promise.resolve();
  const cacheKey = directoryCacheKey(config, parts);
  if (ensuredDirectories.has(cacheKey)) return Promise.resolve();
  let request = directoryRequests.get(cacheKey);
  if (!request) {
    const controller = new AbortController();
    const entry: DirectoryRequest = {
      controller,
      waiters: 0,
      settled: false,
      promise: Promise.resolve(),
    };
    entry.promise = ensureDirectoryParts(config, parts, controller.signal)
      .then(() => {
        ensuredDirectories.add(cacheKey);
      })
      .finally(() => {
        entry.settled = true;
        if (directoryRequests.get(cacheKey) === entry) {
          directoryRequests.delete(cacheKey);
        }
      });
    directoryRequests.set(cacheKey, entry);
    request = entry;
  }
  return joinDirectoryRequest(request, signal);
}

function joinDirectoryRequest(request: DirectoryRequest, signal?: AbortSignal) {
  request.waiters += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    request.waiters -= 1;
    if (request.waiters === 0 && !request.settled) {
      request.controller.abort();
    }
  };

  if (!signal) {
    return request.promise.finally(release);
  }
  if (signal.aborted) {
    release();
    return Promise.reject(abortReason(signal));
  }
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      release();
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", abort, { once: true });
    request.promise.then(
      () => {
        signal.removeEventListener("abort", abort);
        release();
        resolve();
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        release();
        reject(error);
      },
    );
  });
}

async function ensureDirectoryParts(
  config: WebdavSyncConfig,
  parts: string[],
  signal?: AbortSignal,
) {
  let path = "";
  for (const part of parts) {
    if (signal?.aborted) throw abortReason(signal);
    path = path ? `${path}/${part}` : part;
    const response = await webdavFetch(
      { ...config, directory: "" },
      path,
      { method: "MKCOL" },
      signal,
    );
    if (response.ok) {
      void response.body?.cancel().catch(() => undefined);
      continue;
    }
    if (
      (response.status === 405 || response.status === 423) &&
      (await webdavDirectoryExists(config, path, signal))
    ) {
      continue;
    }
    await throwWebdavError(response, webdavText("directoryFailed"), signal);
  }
}

async function webdavDirectoryExists(
  config: WebdavSyncConfig,
  path: string,
  signal?: AbortSignal,
) {
  const response = await webdavFetch(
    { ...config, directory: "" },
    path,
    { method: "PROPFIND", headers: { Depth: "0" } },
    signal,
  );
  const exists = response.ok || response.status === 207;
  void response.body?.cancel().catch(() => undefined);
  return exists;
}

async function webdavFetch(
  config: WebdavSyncConfig,
  path: string,
  init: RequestInit,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw abortReason(signal);
  const headers = new Headers(init.headers);
  if (config.username || config.password) {
    headers.set(
      "Authorization",
      `Basic ${encodeBasicAuth(`${config.username}:${config.password}`)}`,
    );
  }
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, WEBDAV_REQUEST_TIMEOUT_MS);
  try {
    const url = withLocalProxy(buildWebdavUrl(config, path));
    return await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    if (signal?.aborted) throw abortReason(signal);
    if (timedOut) throw new Error(webdavText("requestTimeout"));
    if (error instanceof TypeError) {
      throw new Error(webdavText("connectionFailed"));
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

function buildWebdavUrl(config: WebdavSyncConfig, path: string) {
  const endpoint = new URL(config.url.trim());
  const suffix: string[] = [];
  for (const input of [config.directory, path]) {
    const normalized = normalizePath(input);
    if (normalized) suffix.push(...normalized.split("/").map(encodeURIComponent));
  }
  if (!suffix.length) return endpoint.href.replace(/\/$/, "");
  endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, "")}/${suffix.join("/")}`;
  return endpoint.href;
}

function normalizePath(path: string) {
  const parts = path
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .split("/");
  for (const part of parts) {
    let decoded = part;
    try {
      for (let pass = 0; pass < 4; pass += 1) {
        const next = decodeURIComponent(decoded);
        if (next === decoded) break;
        decoded = next;
        if (pass === 3 && /%[\da-f]{2}/i.test(decoded)) {
          throw new Error(webdavText("pathMissing"));
        }
      }
    } catch {
      throw new Error(webdavText("pathMissing"));
    }
    if (
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\") ||
      /[\u0000-\u001f\u007f]/.test(decoded)
    ) {
      throw new Error(webdavText("pathMissing"));
    }
  }
  return parts.filter((part) => part && part !== ".").join("/");
}

function directoryCacheKey(config: WebdavSyncConfig, parts: string[]) {
  const url = config.url.trim().replace(/\/+$/, "");
  return `${url}|${config.username}|${parts.join("/")}`;
}

function assertWebdavConfig(config: WebdavSyncConfig) {
  const rawUrl = config.url.trim();
  if (!rawUrl) throw new Error(webdavText("urlRequired"));
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(webdavText("urlRequired"));
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(webdavText("urlRequired"));
  }
}

async function throwWebdavError(
  response: Response,
  fallback: string,
  signal?: AbortSignal,
): Promise<never> {
  const detail = await consumeResponseBody(
    () => response.text(),
    response,
    signal,
    webdavText("requestTimeout"),
  ).catch((error) => {
    if (signal?.aborted) throw abortReason(signal);
    return "";
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error(webdavText("authenticationFailed"));
  }
  if (response.status === 404) throw new Error(webdavText("pathMissing"));
  throw new Error(
    webdavText("responseFailed", {
      fallback,
      status: response.status,
      detail: detail ? ` ${detail.slice(0, 120)}` : "",
    }),
  );
}

function consumeResponseBody<T>(
  read: () => Promise<T>,
  response: Response,
  signal: AbortSignal | undefined,
  timeoutMessage: string,
) {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      response.body?.cancel().catch(() => undefined);
      reject(abortReason(signal));
      return;
    }
    let settled = false;
    const finish = (error?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(value as T);
    };
    const abort = () => {
      response.body?.cancel().catch(() => undefined);
      finish(abortReason(signal!));
    };
    const timer = setTimeout(() => {
      response.body?.cancel().catch(() => undefined);
      finish(new Error(timeoutMessage));
    }, WEBDAV_REQUEST_TIMEOUT_MS);
    signal?.addEventListener("abort", abort, { once: true });
    read().then(
      (value) => finish(undefined, value),
      (error) =>
        finish(error instanceof Error ? error : new Error(String(error))),
    );
  });
}

function encodeBasicAuth(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}
