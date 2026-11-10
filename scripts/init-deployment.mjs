import { randomBytes } from "node:crypto";
import { open, unlink } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

export function deploymentOrigin(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error("Provide --origin https://your-public-domain.example"); }
  if (url.protocol !== "https:" || !url.hostname.includes(".") || isIP(url.hostname.replace(/^\[|\]$/g, "")) ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/" || url.port ||
      /(?:^|\.)(?:localhost|local|internal|invalid)$/i.test(url.hostname))
    throw new Error("Production origin must be a public HTTPS domain without a path, port, credentials or query.");
  return { origin: url.origin, domain: url.hostname };
}

export function deploymentTemplate(input) {
  const { origin, domain } = deploymentOrigin(input);
  const password = () => randomBytes(32).toString("hex");
  return `# Private deployment environment. Do not commit, paste, or copy to a frontend bundle.
APP_DOMAIN=${domain}
APP_PUBLIC_ORIGIN=${origin}
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_REDIRECT_URI=${origin}/login/oauth2/code/github
REVIEWER_USERNAME=
REVIEWER_PASSWORD_HASH=
REVIEWER_DISPLAY_NAME=作品评审
DB_PASSWORD=${password()}
DB_ROOT_PASSWORD=${password()}
REDIS_PASSWORD=${password()}
POOL_CREDENTIAL_MASTER_KEY=${randomBytes(32).toString("base64")}
APP_WORKER_CONCURRENCY=2
APP_SSE_MAX_CONNECTIONS=10000
APP_SSE_MAX_CONNECTIONS_PER_USER=8
MUSE_BASE_URL=https://api.example.invalid
MUSE_API_KEY=
MUSE_MEDIA_ALLOWED_HOSTS=
`;
}

function protectWindowsFile(path) {
  const identity = spawnSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true });
  const sid = identity.status === 0 ? identity.stdout.match(/S-1-5-\d+(?:-\d+)+/)?.[0] : null;
  if (!sid) throw new Error("Could not determine the current Windows identity to protect the environment file.");
  const permission = spawnSync("icacls.exe", [path, "/inheritance:r", "/grant:r", `*${sid}:F`, "*S-1-5-18:F", "*S-1-5-32-544:F"], { windowsHide: true, encoding: "utf8" });
  if (permission.status !== 0) throw new Error("Could not restrict the deployment environment file permissions.");
}

export async function writeDeploymentFile(path, origin) {
  const content = deploymentTemplate(origin);
  const handle = await open(path, "wx", 0o600); // Never overwrite or rotate a working deployment's secrets.
  try {
    await handle.writeFile(content, { encoding: "utf8" });
    await handle.close();
    if (process.platform === "win32") protectWindowsFile(path);
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(path).catch(() => {}); // This path was created exclusively by this call.
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  let origin = "", output = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env.production.local");
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--origin" && args[i + 1]) origin = args[++i];
    else if (args[i] === "--output" && args[i + 1]) output = resolve(args[++i]);
    else throw new Error("Usage: node scripts/init-deployment.mjs --origin https://studio.example.com [--output path]");
  }
  await writeDeploymentFile(output, origin);
  console.log(`Created ${output}. Configure GitHub OAuth or run scripts/init-reviewer.mjs before starting Compose. Secrets were not printed.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.code === "EEXIST" ? "Environment file already exists; it was left unchanged." : error.message);
    process.exitCode = 1;
  });
}
