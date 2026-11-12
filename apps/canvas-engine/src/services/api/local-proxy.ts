import i18n from "@/i18n";
import { normalizeLocalProxyUrl } from "@/stores/use-config-store";

type ProxyIdentity = { proxy: string; version?: string | number };
type ProxyCheckOptions = { signal?: AbortSignal; timeoutMs?: number };

const DEFAULT_PROBE_DEADLINE_MS = 8_000;

function parseIdentity(value: unknown): ProxyIdentity | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.proxy !== "string" || !candidate.proxy.trim())
    return undefined;
  const version =
    typeof candidate.version === "string" ||
    typeof candidate.version === "number"
      ? candidate.version
      : undefined;
  return { proxy: candidate.proxy.trim(), version };
}

function abortError() {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Performs a short identity probe without letting a stale request outlive its caller. */
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
    : DEFAULT_PROBE_DEADLINE_MS;
  const timer = setTimeout(
    () =>
      controller.abort(new DOMException("Request timed out", "TimeoutError")),
    timeoutMs,
  );
  const forwardAbort = () =>
    controller.abort(options.signal?.reason ?? abortError());
  options.signal?.addEventListener("abort", forwardAbort, { once: true });

  try {
    const response = await fetch(base.endsWith("/") ? base : `${base}/`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (controller.signal.aborted)
      throw controller.signal.reason ?? abortError();
    if (!response.ok) throw new Error(i18n.t("config.proxy.unreachable"));

    let identity: ProxyIdentity | undefined;
    try {
      identity = parseIdentity(await response.json());
    } catch {
      throw new Error(i18n.t("config.proxy.unreachable"));
    }
    if (controller.signal.aborted)
      throw controller.signal.reason ?? abortError();
    if (!identity) throw new Error(i18n.t("config.proxy.unreachable"));
    const version =
      identity.version == null ? "?" : String(identity.version).trim() || "?";
    return `${identity.proxy} v${version}`;
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
    if (error instanceof TypeError) {
      throw new Error(i18n.t("config.proxy.unreachable"));
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}
