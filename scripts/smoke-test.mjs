import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

// Tests an already running, isolated development instance. Never submits generation.
const base = new URL(process.env.WORKBENCH_SMOKE_URL || "http://localhost:5178");
assert(["localhost", "127.0.0.1", "[::1]"].includes(base.hostname), "Smoke checks are restricted to loopback");
const origin = "http://localhost:5178";
const results = [];
let cookie = "";
async function request(path, { method = "GET", body, expected = 200, headers = {} } = {}) {
  const response = await fetch(new URL(`/api${path}`, base), {
    method,
    headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(method !== "GET" ? { "X-Workbench-Request": "1" } : {}), ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  for (const value of response.headers.getSetCookie()) if (value.startsWith("WORKBENCH_SESSION=")) cookie = value.split(";")[0];
  assert.equal(response.status, expected, `${method} ${path} status`);
  return response;
}
const read = async (path, options) => (await request(path, options)).json();
const check = (name) => { results.push(name); console.log(`PASS ${name}`); };
let installedByTest = false;
try {
  const bootstrap = await read("/bootstrap");
  assert.equal(bootstrap.auth.localEnabled, true, "Requires isolated development local auth");
  assert.equal(bootstrap.user, null);
  check("public bootstrap");
  await read("/auth/local", { method: "POST", body: {} });
  assert((await read("/bootstrap")).user?.id);
  check("Redis session through frontend proxy");

  const catalog = await read("/skills");
  assert(Array.isArray(catalog) && catalog.length >= 3);
  const skill = catalog.find((item) => item.id === "image-create");
  assert(skill?.status === "available");
  if (!skill.installed) {
    await read("/workspace/skills/image-create", { method: "PUT", body: { recipeVersion: skill.recipeVersion } });
    installedByTest = true;
  }
  const detail = await read("/skills/image-create");
  assert.equal(detail.installed, true);
  assert.equal(detail.recipe.path, "/api/jobs");
  assert((await read("/workspace/skills")).some((item) => item.id === skill.id));
  await read("/workspace/skills/storyboard-to-video", { method: "PUT", expected: 409, body: { recipeVersion: "0.1.0" } });
  check("skill catalog, durable installation and planned gate");

  const document = { schemaVersion: 1, nodes: [{ id: randomUUID(), type: "creative", position: { x: 100, y: 100 }, data: { kind: "image", title: "接口验收节点", prompt: "森林里的阳光", skillId: skill.id, skillVersion: skill.recipeVersion } }], edges: [] };
  const project = await read("/projects", { method: "POST", expected: 201, body: { title: "工作台接口验收", document } });
  const saved = await read(`/projects/${project.id}`, { method: "PUT", body: { baseRevision: project.revision, title: project.title, document } });
  assert.equal(saved.revision, project.revision + 1);
  assert.equal((await read(`/projects/${project.id}`)).document.nodes[0].data.skillVersion, skill.recipeVersion);
  await read(`/projects/${project.id}`, { method: "PUT", expected: 409, body: { baseRevision: project.revision, title: project.title, document } });
  assert.deepEqual(await read(`/jobs?projectId=${project.id}`), []);
  check("MySQL document, skill provenance, conflict and jobs read");

  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
  const form = new FormData();
  form.set("file", new Blob([bytes], { type: "image/png" }), "smoke-fixture.png");
  form.set("projectId", project.id);
  const asset = await read("/assets", { method: "POST", expected: 201, body: form });
  const content = await request(`/assets/${asset.id}/content`);
  assert.equal(createHash("sha256").update(Buffer.from(await content.arrayBuffer())).digest("hex"), createHash("sha256").update(bytes).digest("hex"));
  check("authorized upload and media readback");

  const pool = await read("/pool/overview");
  assert(["connected", "disabled", "unavailable"].includes(pool.status));
  assert.deepEqual(Object.keys(pool.accounts).sort(), ["available", "total"]);
  assert(!/"(?:apiKey|cookie|token|accountsList)"/i.test(JSON.stringify(pool)));
  check("pool aggregate contract without credentials");

  // These invalid requests must be rejected before any provider generation call.
  const rejected = await read("/jobs", { method: "POST", expected: 400, headers: { "Idempotency-Key": randomUUID() }, body: { projectId: project.id, nodeId: document.nodes[0].id, kind: "video", model: "doubao-video", prompt: "接口校验，不应提交到上游", duration: 5, width: 1024, height: 1024, referenceAssetIds: [] } });
  assert.equal(rejected.code, "INVALID_REQUEST");
  assert.deepEqual(await read(`/jobs?projectId=${project.id}`), []);
  check("Doubao incompatible request rejected without generation");

  const events = await request("/events");
  const reader = events.body.getReader();
  const first = await reader.read();
  assert(new TextDecoder().decode(first.value).includes("ready"));
  await reader.cancel();
  check("authenticated SSE readiness");

  const report = { checkedAt: new Date().toISOString(), base: base.origin, passed: results.length, checks: results, projectId: project.id, fixtureAssetId: asset.id, generationSubmitted: false, modelDiscovery: bootstrap.integration.modelDiscovery, models: [...bootstrap.models.image, ...bootstrap.models.video].map((item) => item.id), pool: { status: pool.status, accounts: pool.accounts, doubao: pool.doubao } };
  await mkdir(new URL("../context/verification/", import.meta.url), { recursive: true });
  await writeFile(new URL("../context/verification/latest-smoke.json", import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${results.length} checks passed. Test project and fixture retained for inspection.`);
} finally {
  if (installedByTest) await read("/workspace/skills/image-create", { method: "DELETE" });
  if (cookie) await read("/auth/logout", { method: "POST" });
}
