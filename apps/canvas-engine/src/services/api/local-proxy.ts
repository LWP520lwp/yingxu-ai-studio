import i18n from "@/i18n";
import { normalizeLocalProxyUrl } from "@/stores/use-config-store";

type ProxyIdentity = { proxy: string; version?: string | number };
type ProxyCheckOptions = { signal?: AbortSignal; timeoutMs?: number };

const DEFAULT_TIMEOUT_MS = 8_000;

function isProxyIdentity(value: unknown): value is ProxyIdentity {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.proxy === "string" && candidate.proxy.trim().length > 0
  );
}

function abortError() {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Query the proxy's identity endpoint with a bounded, caller-cancellable check. */
export async function testLocalProxy(
  proxyUrl: string,
  options: ProxyCheckOptions = {},
) {
  const base = normalizeLocalProxyUrl(proxyUrl);
  if (!base) throw new Error(i18n.t("config.proxy.missingUrl"));
  if (options.signal?.aborted) throw options.signal.reason ?? abortError();

  const controller = new AbortController();
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(1, options.timeoutMs!)
    : DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(
    () =>
      controller.abort(new DOMException("Request timed out", "TimeoutError")),
    timeoutMs,
  );
  const forwardAbort = () =>
    controller.abort(options.signal?.reason ?? abortError());
  options.signal?.addEventListener("abort", forwardAbort, { once: true });

  try {
    const response = await fetch(`${base}/`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (controller.signal.aborted)
      throw controller.signal.reason ?? abortError();
    if (!response.ok) throw new Error(i18n.t("config.proxy.unreachable"));

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new Error(i18n.t("config.proxy.unreachable"));
    }
    if (controller.signal.aborted)
      throw controller.signal.reason ?? abortError();
    if (!isProxyIdentity(data))
      throw new Error(i18n.t("config.proxy.unreachable"));
    const version =
      typeof data.version === "string" || typeof data.version === "number"
        ? String(data.version).trim()
        : "";
    return `${data.proxy.trim()} v${version || "?"}`;
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason ?? abortError();
    if (controller.signal.aborted) {
      if (
        controller.signal.reason instanceof DOMException &&
        controller.signal.reason.name === "TimeoutError"
      ) {
        throw new Error(i18n.t("config.proxy.unreachable"));
      }
      throw controller.signal.reason ?? abortError();
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}
