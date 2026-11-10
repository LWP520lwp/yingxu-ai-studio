import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

// A real production container stack, reached only through a CI loopback port.
// Secure cookies are forwarded explicitly here; actual browser/TLS validation remains separate.
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = { "--base-url": "base", "--credentials-file": "credentialsFile", "--origin": "origin" }[process.argv[i]];
  if (!key || !process.argv[i + 1]) throw new Error("Usage: node scripts/smoke-production.mjs --base-url http://127.0.0.1:18080 --origin https://studio.example.com --credentials-file /private/reviewer.txt");
  options[key] = process.argv[i + 1];
}
const base = new URL(options.base ?? "http://127.0.0.1:18080");
assert(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname), "Production smoke is restricted to loopback");
assert(options.credentialsFile && options.origin, "Provide the private credentials path and configured origin");
const privateText = await readFile(options.credentialsFile, "utf8");
const username = privateText.match(/^账号：(.+)$/m)?.[1], password = privateText.match(/^密码：(.+)$/m)?.[1];
assert(username && password, "Private reviewer credentials file is invalid");
let cookie = "";
async function request(path, { method = "GET", body, expected = 200 } = {}) {
  const response = await fetch(new URL(path, base), {
    method, headers: { Origin: options.origin, ...(cookie ? { Cookie: cookie } : {}), ...(method !== "GET" ? { "X-Workbench-Request": "1" } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, expected, `${method} ${path} returned an unexpected status`);
  for (const value of response.headers.getSetCookie()) if (value.startsWith("WORKBENCH_SESSION=")) cookie = value.split(";")[0];
  return response;
}
const json = async (path, options) => (await request(path, options)).json();
const html = await (await request("/")).text();assert(html.includes("<div id=\"root\""));
assert((await (await request("/canvas-engine/index.html")).text()).includes("<html"));
const bootstrap = await json("/api/bootstrap");assert.equal(bootstrap.auth.localEnabled,false);assert.equal(bootstrap.user,null);
await request("/api/projects",{expected:401});
await request("/api/auth/local",{method:"POST",body:{},expected:403});
assert.equal((await json("/api/auth/reviewer/config")).enabled,true);
await request("/api/auth/reviewer",{method:"POST",body:{username,password:"invalid-fixture-password"},expected:401});
const login = await json("/api/auth/reviewer",{method:"POST",body:{username,password}});
assert.equal(login.provider,"reviewer");assert(cookie,"Reviewer login must establish a Redis-backed session");
assert.equal((await json("/api/bootstrap")).user.id,login.id);
const document={schemaVersion:1,nodes:[],edges:[]};
const project=await json("/api/projects",{method:"POST",expected:201,body:{title:`生产冷启动验收 ${randomUUID()}`,document}});
assert.equal((await json(`/api/projects/${project.id}`)).id,project.id);
await request(`/api/projects/${project.id}`,{method:"PUT",body:{title:project.title,document,baseRevision:project.revision}});
await request(`/api/projects/${project.id}`,{method:"PUT",body:{title:project.title,document,baseRevision:project.revision},expected:409});
await request("/api/auth/logout",{method:"POST"});
await request("/api/projects",{expected:401});
console.log("PASS production cold start: frontend/canvas, prod auth, private reviewer login, Redis session, MySQL persistence/conflict, logout. No provider generations or credentials were printed.");
