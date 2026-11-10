import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { initializeReviewer, reviewerHash } from "./init-reviewer.mjs";

test("the portable PBKDF2 fixture matches Java and rejects unsafe inputs", () => {
  assert.equal(reviewerHash("reviewer-unit-test-password", Buffer.alloc(16, 7)), "pbkdf2-sha256$600000$07070707070707070707070707070707$6954d4868e2b62677ad43e12a35536bc29cb666d5c0347759686b106d460e0a4");
  assert.throws(() => reviewerHash("short"));
  assert.throws(() => reviewerHash("x".repeat(257)));
  assert.throws(() => reviewerHash("x".repeat(20), Buffer.alloc(15)));
});

test("initialization preserves deployment values and stores only a quoted hash in the environment", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workbench-review-test-"));
  const envFile = join(directory, ".env.local"), credentialsFile = join(directory, "private", "reviewer.txt");
  try {
    await writeFile(envFile, "DB_PASSWORD=fixture-only\nREVIEWER_USERNAME=\nREVIEWER_PASSWORD_HASH=\nREVIEWER_DISPLAY_NAME=\n");
    await initializeReviewer({ envFile, credentialsFile, username: "reviewer-test" });
    const env = await readFile(envFile, "utf8"), privateText = await readFile(credentialsFile, "utf8");
    const password = privateText.match(/^密码：(.+)$/m)?.[1];
    assert.match(password, /^[A-Za-z0-9_-]{36}$/);
    assert.match(env, /^DB_PASSWORD=fixture-only$/m);
    assert.match(env, /^REVIEWER_USERNAME=reviewer-test$/m);
    assert.match(env, /^REVIEWER_PASSWORD_HASH='pbkdf2-sha256\$600000\$[a-f0-9]{32}\$[a-f0-9]{64}'$/m);
    assert.equal(env.includes(password), false);
    assert.equal((env.match(/^REVIEWER_USERNAME=/gm) ?? []).length, 1);
    if (process.platform !== "win32") assert.equal((await stat(credentialsFile)).mode & 0o777, 0o600);
    await assert.rejects(initializeReviewer({ envFile, credentialsFile: join(directory, "new.txt") }), /already exist/);
    assert.equal(await readFile(envFile, "utf8"), env);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("an existing credential file is never overwritten and the environment stays unchanged", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workbench-review-test-"));
  const envFile = join(directory, ".env.local"), credentialsFile = join(directory, "existing.txt");
  try {
    await writeFile(envFile, "DB_PASSWORD=fixture-only\n");
    await writeFile(credentialsFile, "keep-existing");
    await assert.rejects(initializeReviewer({ envFile, credentialsFile }), { code: "EEXIST" });
    assert.equal(await readFile(credentialsFile, "utf8"), "keep-existing");
    assert.equal(await readFile(envFile, "utf8"), "DB_PASSWORD=fixture-only\n");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("credentials cannot be written inside the repository or with an invalid login name", async () => {
  const repository = join(dirname(fileURLToPath(import.meta.url)), "..");
  await assert.rejects(initializeReviewer({ envFile: "unused", credentialsFile: join(repository, "private-reviewer-test.txt") }), /outside the repository/);
  if (process.platform === "win32") await assert.rejects(initializeReviewer({ envFile: "unused", credentialsFile: join(repository.toUpperCase(), "private-reviewer-test.txt") }), /outside the repository/);
  await assert.rejects(initializeReviewer({ envFile: "unused", credentialsFile: join(tmpdir(), "reviewer.txt"), username: "bad user" }), /username/);
});
