import { randomBytes, pbkdf2Sync } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function reviewerHash(password, salt = randomBytes(16)) {
  if (typeof password !== "string" || password.length < 20 || password.length > 256 || salt.length !== 16) throw new Error("Use a random password of at least 20 characters and a 16-byte salt.");
  const iterations = 600000;
  return `pbkdf2-sha256$${iterations}$${salt.toString("hex")}$${pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex")}`;
}
function protect(path) {
  if (process.platform !== "win32") return;
  const identity = spawnSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true });
  const sid = identity.status === 0 ? identity.stdout.match(/S-1-5-\d+(?:-\d+)+/)?.[0] : null;
  if (!sid) throw new Error("Could not determine the current Windows identity.");
  const permissions = spawnSync("icacls.exe", [path, "/inheritance:r", "/grant:r", `*${sid}:F`, "*S-1-5-18:F", "*S-1-5-32-544:F"], { encoding: "utf8", windowsHide: true });
  if (permissions.status !== 0) throw new Error("Could not restrict private file permissions.");
}
export async function initializeReviewer({ envFile, credentialsFile, username = `reviewer-${randomBytes(4).toString("hex")}` }) {
  const envPath = resolve(envFile), credentialsPath = resolve(credentialsFile);
  const local = relative(projectRoot, credentialsPath);
  if (!local || (local !== ".." && !local.startsWith(`..${sep}`) && !isAbsolute(local))) throw new Error("Store reviewer credentials outside the repository.");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{3,63}$/.test(username)) throw new Error("Reviewer username must contain 4-64 letters, digits, dot, underscore or hyphen.");
  const before = await readFile(envPath, "utf8");
  if (/^[\t ]*REVIEWER_(?:USERNAME|PASSWORD_HASH)[\t ]*=[\t ]*[^\s\r\n]+/m.test(before)) throw new Error("Reviewer credentials already exist; refusing to rotate them implicitly.");
  const password = randomBytes(27).toString("base64url");
  const hash = reviewerHash(password);
  // Single quotes prevent Docker Compose from interpolating the dollar signs in the hash.
  const after = `${before.replace(/^[\t ]*REVIEWER_(?:USERNAME|PASSWORD_HASH|DISPLAY_NAME)[\t ]*=.*(?:\r?\n|$)/gm, "").trimEnd()}\n\n# Private review identity; password is stored separately outside the repository.\nREVIEWER_USERNAME=${username}\nREVIEWER_PASSWORD_HASH='${hash}'\nREVIEWER_DISPLAY_NAME=作品评审\n`;
  await mkdir(dirname(credentialsPath), { recursive: true });
  const credentialHandle = await open(credentialsPath, "wx", 0o600);
  const tempPath = `${envPath}.reviewer-${randomBytes(8).toString("hex")}.tmp`;
  try {
    await credentialHandle.writeFile(`映序 · 评委专用访问凭据\n\n账号：${username}\n密码：${password}\n\n仅向作品评委提供。不得提交 GitHub、公开发布或录入公开报名附件。\n此账号拥有普通创作权限，没有平台管理权限。\n`, "utf8");
    await credentialHandle.close();
    protect(credentialsPath);
    const temporary = await open(tempPath, "wx", 0o600);
    try { await temporary.writeFile(after, "utf8"); } finally { await temporary.close(); }
    protect(tempPath);
    await rename(tempPath, envPath);
  } catch (error) {
    await credentialHandle.close().catch(() => {});
    await unlink(tempPath).catch(() => {});
    await unlink(credentialsPath).catch(() => {});
    throw error;
  }
  return { envFile: envPath, credentialsFile: credentialsPath };
}

async function main() {
  const options = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const key = { "--env-file": "envFile", "--credentials-file": "credentialsFile", "--username": "username" }[args[i]];
    if (!key || !args[i + 1]) throw new Error("Usage: node scripts/init-reviewer.mjs --env-file .env.production.local --credentials-file /private/reviewer.txt [--username name]");
    options[key] = args[++i];
  }
  if (!options.envFile || !options.credentialsFile) throw new Error("Both --env-file and --credentials-file are required.");
  const result = await initializeReviewer(options);
  console.log(`Review login configured. Private credentials: ${result.credentialsFile}. No password or hash was printed.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.code === "EEXIST" ? "Private credentials file already exists; nothing was overwritten." : error.message);process.exitCode=1; });
