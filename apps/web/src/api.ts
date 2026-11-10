export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (
    options.method &&
    !["GET", "HEAD", "OPTIONS"].includes(options.method.toUpperCase())
  )
    headers.set("X-Workbench-Request", "1");
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: "include",
    signal: options.signal || AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      response.status,
      data?.message || `请求失败（${response.status}）`,
      data,
    );
  return data as T;
}
export const json = (value: unknown) => JSON.stringify(value);
export function message(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请重试";
}
