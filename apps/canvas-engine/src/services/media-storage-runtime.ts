type BlobLoader = () => Promise<Blob | null>;

/** Object URLs belong to the editor's immutable storage scope. */
export class ObjectUrlRegistry {
  private urls = new Map<string, string>();
  private revisions = new Map<string, number>();
  private loading = new Map<string, Promise<string | undefined>>();

  get(key: string) {
    return this.urls.get(key);
  }

  revision(key: string) {
    return this.revisions.get(key) || 0;
  }

  invalidate(key: string) {
    this.revisions.set(key, this.revision(key) + 1);
    this.loading.delete(key);
    const previous = this.urls.get(key);
    this.urls.delete(key);
    if (previous) URL.revokeObjectURL(previous);
    return this.revision(key);
  }

  put(key: string, blob: Blob) {
    this.invalidate(key);
    return this.adopt(key, URL.createObjectURL(blob));
  }

  adopt(key: string, url: string) {
    const previous = this.urls.get(key);
    if (previous && previous !== url) URL.revokeObjectURL(previous);
    this.urls.set(key, url);
    return url;
  }

  resolve(key: string, read: BlobLoader) {
    const cached = this.get(key);
    if (cached) return Promise.resolve(cached);
    const inFlight = this.loading.get(key);
    if (inFlight) return inFlight;

    const revision = this.revision(key);
    const request = read().then((blob) => {
      if (this.revision(key) !== revision) return this.get(key);
      if (!blob) return undefined;
      return this.adopt(key, URL.createObjectURL(blob));
    });
    this.loading.set(key, request);
    const release = () => {
      if (this.loading.get(key) === request) this.loading.delete(key);
    };
    request.then(release, release);
    return request;
  }
}

export function collectStoredKeys(
  root: unknown,
  matches: (key: string) => boolean,
  keys = new Set<string>(),
) {
  const pending = [root];
  const visited = new WeakSet<object>();
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== "object" || visited.has(item)) continue;
    visited.add(item);
    if ("storageKey" in item && typeof item.storageKey === "string") {
      if (matches(item.storageKey)) keys.add(item.storageKey);
    }
    pending.push(...Object.values(item));
  }
  return keys;
}

export function isServerAssetUrl(url: string) {
  return /^\/api\/assets\/[a-zA-Z0-9-]+\/content(?:\?|$)/.test(url);
}

export function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Aborted", "AbortError");
}

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortReason(signal);
}

export async function fetchBlobWithDeadline(
  url: string,
  options: {
    signal?: AbortSignal;
    timeoutMs: number;
    responseError: () => Error;
    timeoutError: () => Error;
  },
) {
  throwIfAborted(options.signal);
  const controller = new AbortController();
  let deadlineReached = false;
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    deadlineReached = true;
    controller.abort();
  }, options.timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw options.responseError();
    const blob = await response.blob();
    throwIfAborted(options.signal);
    if (deadlineReached) throw options.timeoutError();
    return blob;
  } catch (error) {
    if (options.signal?.aborted) throw abortReason(options.signal);
    if (deadlineReached) throw options.timeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
