import i18n from "@/i18n";
import { withLocalProxy } from "@/stores/use-config-store";
import {
  abortReason,
  fetchBlobWithDeadline,
  throwIfAborted,
} from "./media-storage-runtime";

export type ImageReadOptions = { signal?: AbortSignal; timeoutMs?: number };
export type ImageDimensions = { width: number; height: number };

function failure(name = "ImageReadError") {
  const error = new Error(i18n.t("common.imageReadFailed"));
  error.name = name;
  return error;
}

export function downloadImageBlob(
  source: string,
  options: ImageReadOptions = {},
) {
  return fetchBlobWithDeadline(withLocalProxy(source), {
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? 600_000,
    responseError: () => failure("ImageResponseError"),
    timeoutError: () => failure("ImageTimeoutError"),
  });
}

export function mayUseRemoteImage(
  source: string,
  error: unknown,
  signal?: AbortSignal,
) {
  return (
    /^https?:\/\//i.test(source) &&
    !signal?.aborted &&
    !(
      error instanceof Error &&
      ["ImageResponseError", "ImageTimeoutError"].includes(error.name)
    )
  );
}

/** Decoding owns its event handlers and timer, including synchronous browser failures. */
export function readImageDimensions(
  source: string,
  signal?: AbortSignal,
): Promise<ImageDimensions | null> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const image = new Image();
    let finished = false;
    const settle = (dimensions: ImageDimensions | null, error?: unknown) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      signal?.removeEventListener("abort", cancel);
      image.onload = image.onerror = null;
      if (error) reject(error);
      else resolve(dimensions);
    };
    const cancel = () => settle(null, abortReason(signal!));
    const deadline = setTimeout(() => settle(null), 10_000);
    image.onload = () =>
      settle(
        image.naturalWidth > 0 && image.naturalHeight > 0
          ? { width: image.naturalWidth, height: image.naturalHeight }
          : null,
      );
    image.onerror = () => settle(null);
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      image.src = source;
    } catch (error) {
      settle(null, error);
    }
  });
}

export function imageBlobToDataUrl(
  blob: Blob,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const reader = new FileReader();
    let finished = false;
    const settle = (error?: unknown) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener("abort", cancel);
      reader.onload = reader.onerror = reader.onabort = null;
      if (error) reject(error);
      else resolve(String(reader.result || ""));
    };
    const cancel = () => {
      settle(abortReason(signal!));
      reader.abort();
    };
    reader.onload = () => settle();
    reader.onerror = () => settle(failure());
    reader.onabort = () => settle(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      throwIfAborted(signal);
      reader.readAsDataURL(blob);
    } catch (error) {
      settle(error);
    }
  });
}
