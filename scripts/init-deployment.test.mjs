import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, unlink, rmdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deploymentOrigin, deploymentTemplate, writeDeploymentFile } from "./init-deployment.mjs";

test("production origins reject unsafe or undeployable callback forms", () => {
  for (const origin of ["", "http://studio.example.com", "https://localhost", "https://127.0.0.1", "https://studio.example.com/path", "https://user:secret@studio.example.com", "https://studio.example.com?token=x", "https://studio.example.com:8443", "https://studio.internal"])
    assert.throws(() => deploymentOrigin(origin));
  assert.deepEqual(deploymentOrigin("https://studio.example.com/"), { origin: "https://studio.example.com", domain: "studio.example.com" });
});

test("each deployment receives independent random secrets and no shared OAuth identity", () => {
  const first = deploymentTemplate("https://studio.example.com");
  const second = deploymentTemplate("https://studio.example.com");
  const value = (text, name) => text.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1];
  const names = ["DB_PASSWORD", "DB_ROOT_PASSWORD", "REDIS_PASSWORD"];
  for (const name of names) {
    assert.match(value(first, name), /^[a-f0-9]{64}$/);
    assert.notEqual(value(first, name), value(second, name));
  }
  assert.equal(new Set(names.map((name) => value(first, name))).size, 3);
  assert.equal(Buffer.from(value(first, "POOL_CREDENTIAL_MASTER_KEY"), "base64").length, 32);
  assert.equal(value(first, "GITHUB_CLIENT_SECRET"), "");
  assert.equal(value(first, "GITHUB_REDIRECT_URI"), "https://studio.example.com/login/oauth2/code/github");
});

test("initialization never overwrites an existing environment file", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "workbench-deploy-test-"));
  const path = join(temporary, ".env.production.local");
  try {
    await writeDeploymentFile(path, "https://studio.example.com");
    const before = await readFile(path, "utf8");
    await assert.rejects(writeDeploymentFile(path, "https://other.example.com"), { code: "EEXIST" });
    assert.equal(await readFile(path, "utf8"), before);
    if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
  } finally {
    await unlink(path).catch(() => {});
    await rmdir(temporary);
  }
});
