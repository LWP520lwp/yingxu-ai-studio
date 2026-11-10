import path from "node:path";

export function loadConfig(env = process.env) {
  const token = env.BROWSER_WORKER_TOKEN || "";
  if (Buffer.byteLength(token) < 32 || /[\r\n]/.test(token))
    throw new Error("BROWSER_WORKER_TOKEN must contain at least 32 bytes; it is never printed");
  const profileRoot = path.resolve(env.BROWSER_PROFILE_ROOT || "E:/codex/runtime/creative-workbench/browser-pool/profiles");
  if (process.platform === "win32" && !/^e:[\\/]/i.test(profileRoot))
    throw new Error("Browser profiles must remain on E: for this deployment");
  const integer = (value, fallback, min, max) => {
    const parsed = value === undefined || value === "" ? fallback : Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error("Invalid browser worker numeric configuration");
    return parsed;
  };
  return Object.freeze({
    host: "127.0.0.1",
    port: integer(env.BROWSER_WORKER_PORT, 8091, 1024, 65535),
    token,
    profileRoot,
    executablePath: env.BROWSER_EXECUTABLE_PATH || undefined,
    browserChannel: env.BROWSER_EXECUTABLE_PATH ? undefined : process.platform === "win32" ? "msedge" : undefined,
    interactiveLogin: env.BROWSER_INTERACTIVE_LOGIN_ENABLED === "true",
    maxContexts: integer(env.BROWSER_MAX_CONTEXTS, 2, 1, 8),
    generationTimeoutMs: integer(env.BROWSER_GENERATION_TIMEOUT_SECONDS, 600, 30, 900) * 1000,
    maxBodyBytes: 24 * 1024 * 1024,
    maxMediaBytes: integer(env.BROWSER_MAX_MEDIA_MB, 32, 1, 100) * 1024 * 1024,
    mediaAllowedHosts: new Set(["muse.ai", "www.muse.ai", ...(env.BROWSER_MEDIA_ALLOWED_HOSTS || "").split(",")]
      .map((host) => host.trim().toLowerCase()).filter(Boolean)),
  });
}
