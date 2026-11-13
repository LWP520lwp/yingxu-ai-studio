import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { CodexClient } from "./client.mjs";
import { sanitizeTurnInput } from "./plan.mjs";

const response = (res, status, value) => { if (!res.destroyed) { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); } };
const sameToken = (value, token) => {
  const supplied = Buffer.from(value || ""); const expected = Buffer.from(`Bearer ${token}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
};

async function readJson(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) throw Object.assign(new Error("JSON content type is required"), { status: 415 });
  const body = await new Promise((resolve, reject) => {
    const chunks = []; let bytes = 0;
    const cleanup = () => { req.off("data", data); req.off("end", end); req.off("error", error); req.off("aborted", aborted); };
    const data = (chunk) => {
      bytes += chunk.length;
      if (bytes > 512 * 1024) { cleanup(); req.resume(); reject(Object.assign(new Error("Request exceeds 512 KiB"), { status: 413 })); }
      else chunks.push(chunk);
    };
    const end = () => { cleanup(); resolve(Buffer.concat(chunks).toString("utf8")); };
    const error = (failure) => { cleanup(); reject(failure); };
    const aborted = () => { cleanup(); reject(new DOMException("Request cancelled", "AbortError")); };
    req.on("data", data); req.once("end", end); req.once("error", error); req.once("aborted", aborted);
  });
  try { return JSON.parse(body); }
  catch { throw Object.assign(new Error("Invalid JSON request"), { status: 400 }); }
}

export function createBridge(options = {}) {
  const token = options.token || randomBytes(32).toString("base64url");
  const origins = new Set(options.origins || (process.env.CODEX_BRIDGE_ORIGINS || "http://localhost:5178").split(",").map((v) => v.trim()).filter(Boolean));
  const factory = options.createClient || (() => CodexClient.open());
  let busy = false;
  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) { response(res, 403, { error: "This origin is not allowed" }); return; }
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      // Chrome's loopback network permission remains a browser-controlled prompt.
      res.setHeader("Access-Control-Allow-Private-Network", "true");
    }
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    if (!sameToken(req.headers.authorization, token)) { response(res, 401, { error: "Enter the bridge token shown in your local terminal" }); return; }
    if (!((req.method === "GET" && req.url === "/health") || (req.method === "POST" && req.url === "/turn"))) { response(res, 404, { error: "Unknown bridge route" }); return; }
    if (busy) { response(res, 409, { error: "A Codex request is already active" }); return; }
    busy = true;
    let client;
    const abort = new AbortController();
    const onClosed = () => { if (!res.writableEnded) { abort.abort(); void client?.close().catch(() => {}); } };
    res.on("close", onClosed);
    req.on("aborted", () => abort.abort());
    try {
      let input = null;
      if (req.method === "POST") {
        const body = await readJson(req);
        try { input = sanitizeTurnInput(body); }
        catch (error) { throw Object.assign(error, { status: 400 }); }
      }
      if (abort.signal.aborted) return;
      client = await factory();
      if (abort.signal.aborted) return;
      const status = await client.status();
      if (abort.signal.aborted) return;
      if (!input) { response(res, 200, status); return; }
      if (!status.connected) { response(res, 409, { error: "Run codex login on this computer, then reconnect" }); return; }
      if (!status.models.some((model) => model.id === input.model)) { response(res, 400, { error: "Select a model returned by this Codex connection" }); return; }
      const plan = await client.plan(input, abort.signal);
      if (!abort.signal.aborted) response(res, 200, { plan });
    } catch (error) {
      if (!abort.signal.aborted) response(res, error.status || (error.name === "AbortError" ? 408 : 502), { error: error.message || "Codex connection failed" });
    } finally {
      res.off("close", onClosed);
      try { await client?.close(); } catch { /* temporary process cleanup must not keep the lock */ }
      busy = false;
    }
  });
  server.requestTimeout = 210000;
  server.headersTimeout = 10000;
  return { server, token, origins: [...origins] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const bridge = createBridge();
  const port = Number(process.env.CODEX_BRIDGE_PORT || 4599);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("CODEX_BRIDGE_PORT must be between 1024 and 65535");
  bridge.server.listen(port, "127.0.0.1", () => {
    console.log(`Yingxu Codex bridge: http://127.0.0.1:${port}`);
    console.log(`Allowed origins: ${bridge.origins.join(", ")}`);
    console.log(`Local session token: ${bridge.token}`);
    console.log("Paste this token into the canvas Codex panel. It expires when this process stops.");
  });
}
