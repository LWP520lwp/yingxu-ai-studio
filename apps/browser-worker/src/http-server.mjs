import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { WorkerError, errorBody } from "./errors.mjs";
import { accountId } from "./validation.mjs";

export function createWorkerServer(config, pool) {
  return createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    try {
      if (!authorized(request.headers.authorization, config.token)) throw new WorkerError(401, "UNAUTHENTICATED", "需要本机 worker 凭据");
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (url.search || url.hash) throw new WorkerError(400, "INVALID_PATH", "worker 路径不接受查询或片段");
      if (request.method === "GET" && url.pathname === "/health")
        return send(response, 200, { status: "ok", service: "browser-worker", capabilities: { nativeMuse: true, nativeDoubaoGeneration: false } });
      const match = /^\/accounts\/([^/]+)(?:\/(status|login|close|generate))?$/.exec(url.pathname);
      if (!match) throw new WorkerError(404, "NOT_FOUND", "找不到 worker 路径");
      const id = accountId(match[1]);
      const action = match[2] || "account";
      if (request.method === "GET" && action === "status") return send(response, 200, await pool.status(id));
      if (request.method === "POST" && action === "login") return send(response, 200, await pool.login(id, await readJson(request, config.maxBodyBytes)));
      if (request.method === "POST" && action === "close") return send(response, 200, await pool.close(id));
      if (request.method === "DELETE" && action === "account") return send(response, 200, await pool.remove(id));
      if (request.method === "POST" && action === "generate") return send(response, 200, await pool.generate(id, await readJson(request, config.maxBodyBytes)));
      throw new WorkerError(405, "METHOD_NOT_ALLOWED", "不支持此 worker 方法");
    } catch (error) {
      const result = errorBody(error);
      return send(response, result.status, result.body);
    }
  });
}

function authorized(header, token) {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

async function readJson(request, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new WorkerError(413, "REQUEST_TOO_LARGE", "worker 请求超过部署者设置的上限");
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("object required");
    return data;
  } catch {
    throw new WorkerError(400, "INVALID_JSON", "worker 请求需要有效的 JSON 对象");
  }
}

function send(response, status, body) {
  if (response.destroyed || response.writableEnded) return;
  const serialized = JSON.stringify(body);
  response.writeHead(status, { "Content-Length": Buffer.byteLength(serialized) });
  response.end(serialized);
}
