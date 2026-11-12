import assert from "node:assert/strict";
import { mkdtemp, mkdir, lstat, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createWorkerServer } from "../src/http-server.mjs";
import { WorkerError } from "../src/errors.mjs";
import { BrowserPool } from "../src/browser-pool.mjs";
import { accountId, accountPath, generationInput, mediaMime, mediaUrl } from "../src/validation.mjs";

const TOKEN = "test-browser-worker-token-0123456789abcdef";
const UUID = "39f929a0-cf9a-47a1-af4e-77c8588c005c";
const settings = (profileRoot, extra = {}) => ({
  host: "127.0.0.1", port: 0, token: TOKEN, profileRoot, interactiveLogin: true,
  maxContexts: 2, generationTimeoutMs: 500, maxBodyBytes: 1024 * 1024,
  maxMediaBytes: 1024 * 1024, mediaAllowedHosts: new Set(["cdn.example.com"]), ...extra,
});
function fakePage(overrides = {}) {
  return {
    currentUrl: "about:blank",
    isClosed: () => false,
    url() { return this.currentUrl; },
    async goto(url) { this.currentUrl = url; },
    async evaluate() { return { body: "", hasComposer: false, hasLogin: true, captcha: false }; },
    async close() {},
    ...overrides,
  };
}
async function serverFor(pool, profileRoot) {
  const config = settings(profileRoot);
  const server = createWorkerServer(config, pool);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, request: (route, options = {}) => fetch(base + route, { ...options, headers: { Authorization: `Bearer ${TOKEN}`, ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } }) };
}

test("account IDs and profile roots reject path traversal and non-UUIDs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "frameflow-worker-"));
  try {
    assert.equal(accountId(UUID), UUID);
    for (const value of ["../escape", "not-a-uuid", "%2e%2e%2foutside", UUID + "/.."])
      assert.throws(() => accountId(value), WorkerError);
    assert.equal(accountPath(root, UUID), path.join(root, UUID));
    assert.throws(() => accountPath(root, "../escape"), WorkerError);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("generation validation constrains provider, model, data URL bytes and actual media signature", () => {
  assert.throws(() => generationInput({ provider: "muse", kind: "image", prompt: "x", model: "doubao-image" }), /模型/);
  assert.throws(() => generationInput({ provider: "muse", kind: "image", prompt: "x", referenceImages: ["https://attacker.example/x.png"] }), /data URL/);
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";
  assert.equal(generationInput({ provider: "muse", kind: "image", prompt: "x", referenceImages: [png] }).referenceImages.length, 1);
  assert.throws(() => generationInput({ provider: "muse", kind: "image", prompt: "x", referenceImages: ["data:image/png;base64,PGh0bWw+bad"] }), WorkerError);
  assert.throws(() => mediaMime(Buffer.from("<html>error</html>"), "image"), /预期的图片/);
  assert.throws(() => mediaMime(Buffer.from("\0\0\0\x18ftypmp42"), "image"), /预期的图片/);
  assert.throws(() => mediaUrl("http://cdn.example.com/x.png", new Set(["cdn.example.com"])), /获信任/);
  assert.equal(mediaUrl("https://cdn.example.com/x.png", new Set(["cdn.example.com"])), "https://cdn.example.com/x.png");
});

test("every endpoint is bearer protected and login is disabled unless operator opts in", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "frameflow-worker-"));
  const pool = new BrowserPool(settings(root, { interactiveLogin: false }), () => { throw new Error("Playwright must remain lazy"); });
  const { server, base, request } = await serverFor(pool, root);
  try {
    const anonymous = await fetch(base + "/health");
    assert.equal(anonymous.status, 401);
    assert.equal((await (await request("/health")).json()).status, "ok");
    const id = await request(`/accounts/${UUID}/status`);
    assert.equal(id.status, 200);
    assert.equal((await id.json()).state, "login_required");
    const disabled = await request(`/accounts/${UUID}/login`, { method: "POST", body: JSON.stringify({ provider: "muse" }) });
    assert.equal(disabled.status, 403);
    assert.equal((await disabled.json()).code, "INTERACTIVE_LOGIN_DISABLED");
    const notReady = await request(`/accounts/${UUID}/generate`, { method: "POST", body: JSON.stringify({ provider: "muse", kind: "image", prompt: "must not send" }) });
    assert.equal(notReady.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("login creates one isolated account profile and a status check never opens a browser", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "frameflow-worker-"));
  let launches = 0;
  const page = fakePage({ currentUrl: "https://www.muse.ai/", async evaluate() { return { body: "", hasComposer: true, hasLogin: false, captcha: false }; } });
  const playwright = { chromium: { launchPersistentContext: async () => {
    launches++;
    return { pages: () => [page], close: async () => {} };
  } } };
  const pool = new BrowserPool(settings(root), async () => playwright);
  try {
    assert.equal((await pool.status(UUID)).state, "login_required");
    assert.equal(launches, 0);
    const login = await pool.login(UUID, { provider: "muse" });
    assert.equal(login.state, "login_required");
    assert.equal(launches, 1);
    const active = await pool.status(UUID);
    assert.equal(active.state, "ready");
    assert.deepEqual(active.capabilities, { image: true, video: true });
    const metadata = JSON.parse(await readFile(path.join(root, UUID, "worker.json"), "utf8"));
    assert.deepEqual(metadata, { id: UUID, provider: "muse", version: 1 });
    await assert.rejects(pool.login(UUID, { provider: "doubao" }), { code: "ACCOUNT_PROVIDER_MISMATCH" });
    await pool.close(UUID);
    assert.equal((await lstat(path.join(root, UUID))).isDirectory(), true);
    assert.equal((await pool.status(UUID)).state, "login_required");
    await pool.remove(UUID);
    await assert.rejects(lstat(path.join(root, UUID)), { code: "ENOENT" });
  } finally {
    await pool.closeAll();
    await rm(root, { recursive: true, force: true });
  }
});

test("uses installed Edge channel by default when no executable is configured", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "frameflow-worker-"));
  const options = [];
  const playwright = { chromium: { launchPersistentContext: async (_folder, launchOptions) => {
    options.push(launchOptions);
    return { pages: () => [fakePage()], close: async () => {} };
  } } };
  const pool = new BrowserPool(settings(root, { browserChannel: "msedge" }), async () => playwright);
  try {
    await pool.login(UUID, { provider: "muse" });
    assert.equal(options.length, 1);
    assert.equal(options[0].channel, "msedge");
    assert.equal(options[0].executablePath, undefined);
  } finally { await pool.closeAll(); await rm(root, { recursive: true, force: true }); }
});

test("explicit executable path takes priority over a configured browser channel", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "frameflow-worker-"));
  const options = [];
  const playwright = { chromium: { launchPersistentContext: async (_folder, launchOptions) => {
    options.push(launchOptions);
    return { pages: () => [fakePage()], close: async () => {} };
  } } };
  const pool = new BrowserPool(settings(root, { browserChannel: "msedge", executablePath: "C:/Browser/edge.exe" }), async () => playwright);
  try {
    await pool.login(UUID, { provider: "muse" });
    assert.equal(options.length, 1);
    assert.equal(options[0].executablePath, "C:/Browser/edge.exe");
    assert.equal(options[0].channel, undefined);
  } finally { await pool.closeAll(); await rm(root, { recursive: true, force: true }); }
});

test("symlinked profile directories cannot be opened or recursively deleted", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "frameflow-worker-"));
  const other = await mkdtemp(path.join(os.tmpdir(), "frameflow-outside-"));
  const id = "a54e00ce-59ae-461c-af49-40090ad868bf";
  try {
    await symlink(other, path.join(root, id), "junction");
    const pool = new BrowserPool(settings(root), async () => { throw new Error("must not start browser"); });
    await assert.rejects(pool.login(id, { provider: "muse" }), { code: "INVALID_ACCOUNT_PATH" });
    await assert.rejects(pool.remove(id), { code: "INVALID_ACCOUNT_PATH" });
    assert.equal((await lstat(other)).isDirectory(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(other, { recursive: true, force: true });
  }
});

test("two concurrent actions for one account cannot share a browser profile", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "frameflow-worker-"));
  const pool = new BrowserPool(settings(root), async () => ({ chromium: { launchPersistentContext: async () => ({ pages: () => [], close: async () => {} }) } }));
  try {
    const first = pool.login(UUID, { provider: "muse" }).catch((error) => error);
    const busy = await pool.close(UUID).catch((error) => error);
    assert.equal(busy.code, "ACCOUNT_BUSY");
    assert.equal((await first).code, "BROWSER_LAUNCH_FAILED");
  } finally { await pool.closeAll(); await rm(root, { recursive: true, force: true }); }
});

test("HTTP login/status/delete protocol never returns a profile path or session material", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "frameflow-worker-"));
  const page = fakePage({ currentUrl: "https://www.muse.ai/", async evaluate() { return { body: "", hasComposer: false, hasLogin: true, captcha: false }; } });
  const pool = new BrowserPool(settings(root), async () => ({ chromium: { launchPersistentContext: async () => ({ pages: () => [page], close: async () => {} }) } }));
  const { server, request } = await serverFor(pool, root);
  try {
    const login = await request(`/accounts/${UUID}/login`, { method: "POST", body: JSON.stringify({ provider: "muse" }) });
    const data = await login.json();
    assert.equal(data.state, "login_required");
    assert.doesNotMatch(JSON.stringify(data), /profileRoot|worker\.json|Cookie|token/i);
    const removed = await request(`/accounts/${UUID}`, { method: "DELETE" });
    assert.deepEqual(await removed.json(), { deleted: true });
    const rejected = await fetch(`http://127.0.0.1:${server.address().port}/accounts/not-uuid/status`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(rejected.status, 400);
  } finally {
    await pool.closeAll();
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("Doubao generation is explicit unsupported and never starts browser work", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "frameflow-worker-"));
  let loads = 0;
  const pool = new BrowserPool(settings(root), async () => { loads++; throw new Error("Playwright must not load"); });
  try {
    await assert.rejects(pool.generate(UUID, { provider: "doubao", kind: "image", prompt: "test" }), (error) => {
      assert.equal(error.status, 501);
      assert.equal(error.code, "UNSUPPORTED_CAPABILITY");
      assert.equal(error.submissionUncertain, false);
      return true;
    });
    assert.equal(loads, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Muse generation separates pre-send rejection from post-send ambiguous verification", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "frameflow-worker-"));
  let clickCount = 0;
  let rejectBeforeSend = true;
  const page = fakePage({
    currentUrl: "https://www.muse.ai/",
    async goto(url) { this.currentUrl = url; },
    async evaluate(callback) {
      const source = String(callback);
      if (source.includes("hasComposer")) return { body: rejectBeforeSend ? "" : clickCount ? "安全验证" : "", hasComposer: true, hasLogin: false, captcha: !rejectBeforeSend && clickCount > 0 };
      return [];
    },
    getByRole(role, options) {
      const composer = role === "textbox";
      const send = role === "button" && options?.name instanceof RegExp;
      return {
        last() { return this; },
        async count() { return composer || send && !rejectBeforeSend ? 1 : 0; },
        async fill() {},
        async isEnabled() { return true; },
        async click() { clickCount++; },
      };
    },
    async waitForTimeout() {},
  });
  const pool = new BrowserPool(settings(root), async () => ({ chromium: { launchPersistentContext: async () => ({ pages: () => [page], close: async () => {} }) } }));
  try {
    await pool.login(UUID, { provider: "muse" });
    const before = await pool.generate(UUID, { provider: "muse", kind: "image", prompt: "no send control" }).catch((error) => error);
    assert.equal(before.code, "SEND_NOT_READY");
    assert.equal(before.submissionUncertain, false);
    assert.equal(clickCount, 0);

    rejectBeforeSend = false;
    const after = await pool.generate(UUID, { provider: "muse", kind: "image", prompt: "verification after send" }).catch((error) => error);
    assert.equal(after.code, "VERIFICATION_REQUIRED");
    assert.equal(after.submissionUncertain, true);
    assert.equal(clickCount, 1);
  } finally { await pool.closeAll(); await rm(root, { recursive: true, force: true }); }
});
