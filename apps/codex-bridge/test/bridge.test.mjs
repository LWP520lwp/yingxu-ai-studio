import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import { EventEmitter } from "node:events";
import { CodexClient } from "../src/client.mjs";
import { createBridge } from "../src/server.mjs";
import { sanitizeTurnInput, validatePlan } from "../src/plan.mjs";

const proposal = () => ({ summary: "Plan", nodes: [{ id: "shot1", type: "config", title: "First shot", content: "", prompt: "A close shot of a leaf", x: 0, y: 0, mode: "video" }], connections: [] });
const token = "test-only-bridge-token-0000000000000000";

test("protocol client handshakes, lists real model fields and enforces a read-only planning turn", async () => {
  const messages = [];
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.exitCode = null;
  child.kill = () => { child.exitCode = 0; child.emit("exit", 0); return true; };
  const send = (message) => child.stdout.write(`${JSON.stringify(message)}\n`);
  child.stdin = new Writable({ write(chunk, encoding, callback) {
    const message = JSON.parse(chunk.toString()); messages.push(message);
    const result = {
      initialize: { userAgent: "test" },
      "account/read": { account: { type: "chatgpt", email: "must-not-be-exposed@example.test" } },
      "model/list": { data: [{ model: "available-model", displayName: "Available", isDefault: true }], nextCursor: null },
      "config/read": { config: { mcp_servers: { private: { enabled: true } } } },
      "thread/start": { thread: { id: "thread-test" } },
      "turn/start": { turn: { id: "turn-test" } },
    }[message.method];
    if (message.id !== undefined && message.method) queueMicrotask(() => send({ id: message.id, result }));
    if (message.method === "turn/start") queueMicrotask(() => {
      send({ id: 900, method: "item/commandExecution/requestApproval", params: {} });
      send({ method: "item/completed", params: { threadId: "thread-test", item: { type: "agentMessage", phase: "final_answer", text: JSON.stringify(proposal()) } } });
      send({ method: "turn/completed", params: { threadId: "thread-test", turn: { id: "turn-test", status: "completed" } } });
    });
    callback();
  } });
  const client = await CodexClient.open({ spawn: () => child });
  try {
    assert.equal(messages[0].method, "initialize"); assert.equal(messages[1].method, "initialized");
    const status = await client.status();
    assert.deepEqual(status, { connected: true, accountType: "chatgpt", models: [{ id: "available-model", name: "Available", isDefault: true }] });
    const plan = await client.plan({ model: "available-model", prompt: "Plan a scene", snapshot: { nodes: [], connections: [] } });
    assert.deepEqual(plan, proposal());
    const thread = messages.find((entry) => entry.method === "thread/start").params;
    assert.equal(thread.ephemeral, true); assert.equal(thread.sandbox, "read-only"); assert.equal(thread.approvalPolicy, "never");
    assert.equal(Object.hasOwn(thread, "runtimeWorkspaceRoots"), false);
    assert.equal(thread.config["mcp_servers.private.enabled"], false);
    const turn = messages.find((entry) => entry.method === "turn/start").params;
    assert.deepEqual(turn.sandboxPolicy, { type: "readOnly", networkAccess: false });
    assert.equal(turn.outputSchema.additionalProperties, false);
    assert.equal(messages.find((entry) => entry.id === 900).error.code, -32601);
  } finally { await client.close(); }
});

test("input and plan guards strip extra context and reject unsupported mutations", () => {
  const clean = sanitizeTurnInput({ prompt: "Plan", model: "available", snapshot: { nodes: [{ id: "n", metadata: { token: "secret" }, url: "private" }], connections: [] } });
  assert.equal(JSON.stringify(clean).includes("secret"), false);
  assert.equal(JSON.stringify(clean).includes("private"), false);
  assert.deepEqual(validatePlan(proposal()), proposal());
  assert.throws(() => validatePlan({ ...proposal(), delete: ["existing"] }));
  assert.throws(() => validatePlan({ ...proposal(), connections: [{ from: "shot1", to: "existing" }] }));
});

test("cancellation during setup never starts a later Codex operation", async () => {
  for (const stage of ["before-setup", "config/read", "thread/start"]) {
    const controller = new AbortController();
    const methods = [];
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.exitCode = 0;
    child.stdin = new Writable({ write(chunk, _encoding, callback) {
      const message = JSON.parse(chunk.toString()); methods.push(message.method);
      queueMicrotask(() => {
        if (message.method === stage) controller.abort();
        const result = message.method === "config/read" ? { config: {} } : { thread: { id: "cancelled-setup" } };
        child.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`);
      });
      callback();
    } });
    const client = new CodexClient(child);
    if (stage === "before-setup") controller.abort();
    try {
      await assert.rejects(client.plan({ prompt: "Plan", model: "available", snapshot: {} }, controller.signal), { name: "AbortError" });
      assert.equal(methods.includes("turn/start"), false, stage);
      if (stage === "config/read") assert.equal(methods.includes("thread/start"), false);
      if (stage === "before-setup") assert.equal(methods.length, 0);
    } finally { await client.close(); }
  }
});

test("cancellation while a turn starts interrupts it as soon as its ID arrives", async () => {
  const controller = new AbortController();
  const methods = [];
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.exitCode = 0;
  const send = (message) => child.stdout.write(`${JSON.stringify(message)}\n`);
  child.stdin = new Writable({ write(chunk, _encoding, callback) {
    const message = JSON.parse(chunk.toString()); methods.push(message.method);
    queueMicrotask(() => {
      let result = {};
      if (message.method === "config/read") result = { config: {} };
      if (message.method === "thread/start") result = { thread: { id: "cancelled-turn" } };
      if (message.method === "turn/start") {
        controller.abort();
        send({ method: "turn/started", params: { threadId: "cancelled-turn", turn: { id: "turn-id" } } });
        assert.equal(methods.at(-1), "turn/interrupt");
        result = { turn: { id: "turn-id" } };
      }
      send({ id: message.id, result });
    });
    callback();
  } });
  const client = new CodexClient(child);
  try {
    await assert.rejects(client.plan({ prompt: "Plan", model: "available", snapshot: {} }, controller.signal), { name: "AbortError" });
    assert.equal(methods.filter((method) => method === "turn/interrupt").length, 1);
  } finally { await client.close(); }
});

test("every displayed proposal field rejects credential formats and unsafe URLs", () => {
  const unsafe = [
    `github_pat_${"A".repeat(40)}`,
    `Bearer ${"b".repeat(24)}+/==`,
    `ghp_${"c".repeat(24)}`,
    `sk-${"d".repeat(24)}`,
    "-----BEGIN RSA PRIVATE KEY-----",
    "https://example.test/secret",
  ];
  for (const field of ["summary", "title", "content", "prompt"]) {
    for (const value of unsafe) {
      const plan = proposal();
      if (field === "summary") plan.summary = value;
      else plan.nodes[0][field] = value;
      assert.throws(() => validatePlan(plan), field);
    }
  }
  const description = "解释 metadata: 字段及 Bearer authentication 授权的含义";
  const plan = proposal(); plan.summary = description;
  Object.assign(plan.nodes[0], { title: description, content: description, prompt: description });
  assert.deepEqual(validatePlan(plan), plan);
});

test("HTTP bridge rejects foreign origins, missing auth and unavailable model IDs", async () => {
  const clients = [];
  const bridge = createBridge({ token, origins: ["http://localhost:5178"], createClient: async () => {
    const client = { status: async () => ({ connected: true, accountType: "chatgpt", models: [{ id: "available", name: "Available" }] }), plan: async () => proposal(), close: async () => {} }; clients.push(client); return client;
  } });
  await new Promise((resolve) => bridge.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${bridge.server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/health`, { headers: { Origin: "https://untrusted.example", Authorization: `Bearer ${token}` } })).status, 403);
    assert.equal((await fetch(`${base}/health`)).status, 401);
    const health = await fetch(`${base}/health`, { headers: { Origin: "http://localhost:5178", Authorization: `Bearer ${token}` } });
    assert.equal(health.status, 200); assert.equal(health.headers.get("access-control-allow-origin"), "http://localhost:5178");
    const invalid = await fetch(`${base}/turn`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "unavailable", prompt: "Plan" }) });
    assert.equal(invalid.status, 400);
    const valid = await fetch(`${base}/turn`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "available", prompt: "Plan" }) });
    assert.equal(valid.status, 200); assert.deepEqual((await valid.json()).plan, proposal());
    assert.equal(clients.length, 3);
  } finally { await new Promise((resolve) => bridge.server.close(resolve)); }
});

test("HTTP bridge bounds input before starting Codex", async () => {
  let opened = 0;
  const bridge = createBridge({ token, createClient: async () => { opened++; throw new Error("Must not start"); } });
  await new Promise((resolve) => bridge.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${bridge.server.address().port}`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  try {
    const invalid = await fetch(`${base}/turn`, { method: "POST", headers, body: '{"prompt":""}' });
    assert.equal(invalid.status, 400);
    const large = await fetch(`${base}/turn`, { method: "POST", headers, body: JSON.stringify({ prompt: "a".repeat(513 * 1024) }) });
    assert.equal(large.status, 413);
    assert.equal(opened, 0);
  } finally { await new Promise((resolve) => bridge.server.close(resolve)); }
});

test("disconnect during model discovery cannot start a planning turn", async () => {
  let began; const discovering = new Promise((resolve) => { began = resolve; });
  let finishStatus; const status = new Promise((resolve) => { finishStatus = resolve; });
  let retired; const closed = new Promise((resolve) => { retired = resolve; });
  let plans = 0;
  const bridge = createBridge({ token, createClient: async () => ({
    status: async () => { began(); return status; },
    plan: async () => { plans++; return proposal(); },
    close: async () => retired(),
  }) });
  await new Promise((resolve) => bridge.server.listen(0, "127.0.0.1", resolve));
  const controller = new AbortController();
  const request = fetch(`http://127.0.0.1:${bridge.server.address().port}/turn`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "Plan", model: "available" }), signal: controller.signal,
  });
  void request.catch(() => {});
  try {
    await discovering; controller.abort(); await assert.rejects(request); await closed;
    finishStatus({ connected: true, models: [{ id: "available" }] });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(plans, 0);
  } finally {
    controller.abort(); finishStatus({ connected: false, models: [] });
    await new Promise((resolve) => bridge.server.close(resolve));
  }
});

test("one active request owns the bridge and browser cancellation retires it", async () => {
  let began; const started = new Promise((resolve) => { began = resolve; });
  let retired; const closed = new Promise((resolve) => { retired = resolve; });
  const bridge = createBridge({ token, createClient: async () => ({
    status: async () => ({ connected: true, accountType: "chatgpt", models: [{ id: "available", name: "Available" }] }),
    plan: async (_input, signal) => { began(); return new Promise((_resolve, reject) => { signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true }); }); },
    close: async () => retired(),
  }) });
  await new Promise((resolve) => bridge.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${bridge.server.address().port}`;
  const controller = new AbortController();
  const active = fetch(`${base}/turn`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "Plan", model: "available" }), signal: controller.signal });
  void active.catch(() => {});
  try {
    await started;
    const conflict = await fetch(`${base}/health`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(conflict.status, 409);
    controller.abort(); await assert.rejects(active); await closed;
  } finally { controller.abort(); await new Promise((resolve) => bridge.server.close(resolve)); }
});
