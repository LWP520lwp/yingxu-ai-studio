# FrameFlow browser worker

This Node 22.12+ ES module package is part of the repository's npm workspaces. It uses Playwright 1.58.2 with one persistent browser profile per platform account UUID. It does not depend on or copy the closed-source MuseCanvas installation. Install dependencies from the repository root with `npm install`, using the root lockfile and shared dependency tree; do not run a separate install or create a lockfile under `apps/browser-worker`. Installing the package does not open an account browser.

## Start

Run from the interactive desktop session of the Windows account that owns the E-drive runtime. The Windows scripts read the repository's shared `.env.local`, so the Java API and worker receive the same bearer token. If this is a new checkout, initialize the dedicated MySQL/Redis environment first with `scripts/start-infra.ps1`.

From the repository root:

```powershell
# Start API, web and worker together on free ports. Worker startup is opt-in.
.\scripts\start-dev.ps1 -WithBrowserWorker

# Or start only the worker, preserving the currently running API and web.
.\scripts\start-browser-worker.ps1

# Initialize shared local credentials without starting any process.
.\scripts\start-browser-worker.ps1 -PrepareOnly

# Stop only the recorded worker; never search for arbitrary node.exe processes.
.\scripts\stop-browser-worker.ps1

# Stop the recorded API/web processes and the separately recorded worker.
.\scripts\stop-dev.ps1 -WithBrowserWorker
```

`start-browser-worker.ps1` securely appends missing or blank `BROWSER_WORKER_TOKEN` and `POOL_CREDENTIAL_MASTER_KEY` values to the protected `.env.local`. The bearer token and independent AES-GCM master key each use 32 random bytes; the master key uses standard Base64. Existing nonempty values are preserved and validated, and secret values are never printed or added to process arguments. Blank keys are initialized by an appended entry, which the shared environment loader reads last. Back up the master key separately; losing or changing it makes imported service credentials undecryptable. Never put either secret in a browser `VITE_*` variable. An API already running before these values were initialized must be restarted explicitly to load them; standalone worker startup does not restart it.

The scripts validate an `http://127.0.0.1` worker origin and matching `BROWSER_WORKER_PORT` (8091 by default), resolve the root workspace dependency, and verify authenticated `/health`. A matching tracked healthy worker is reused. A foreign process occupying the port is left untouched. The worker uses its own `browser-worker-process.json`, separate from `dev-processes.json`; stopping requires the recorded PID, executable path and start time to match. `stop-dev.ps1` keeps the worker running unless `-WithBrowserWorker` is supplied.

Logs are under the dedicated E-drive runtime's `logs/browser-worker.*.log`. Worker temporary files, npm cache location and Playwright browser cache are set under `E:/codex/runtime/creative-workbench/browser-pool`; a configured runtime, profile root or Playwright cache outside E: is rejected. Startup and authenticated health checks do not open browser windows or account profiles. Keep the service bound to loopback; do not reverse proxy or publish it to the network. Every endpoint, including `GET /health`, requires the bearer token.

`BROWSER_INTERACTIVE_LOGIN_ENABLED` defaults to false. The deployment operator must explicitly enable it after restricting the Java account-login action to the machine administrator. The API must not let ordinary remote users open windows on the host. All paths are server generated under the absolute E-drive `BROWSER_PROFILE_ROOT`; UUIDs are validated and symlinks rejected. Each context receives a Windows ACL limited to the worker owner, SYSTEM, and local Administrators (or mode 0700 on POSIX).

On Windows, if `BROWSER_EXECUTABLE_PATH` is blank the worker uses Playwright's `msedge` channel to launch the Edge stable browser installed for the interactive desktop account; it does not download or install a browser. Set `BROWSER_EXECUTABLE_PATH` to an explicit executable when Edge is unavailable or another browser is required. Non-Windows deployments use the Playwright-managed Chromium runtime. The worker never starts during build or tests.

## Contract

All successful responses are JSON. All errors are `{code,message,submissionUncertain}` with an HTTP error status. `submissionUncertain` is false for validated/rejected-before-submit errors and true after invoking the send click when the worker cannot prove the final outcome. Clients must mark uncertain jobs for reconciliation and must not replay a generation request automatically.

| Method | Path | Effect |
|---|---|---|
| `GET` | `/health` | Authenticated worker health; no browser or profile is opened |
| `POST` | `/accounts/{uuid}/login` with `{ "provider": "muse" \| "doubao" }` | May create the account's UUID-only directory and start a visible persistent browser. The human completes sign-in and verification. The worker does not enter passwords/codes or bypass verification. |
| `GET` | `/accounts/{uuid}/status` | Read current visible page state; does not start or attach to a browser after worker restart |
| `POST` | `/accounts/{uuid}/close` | Close browser but retain its profile for the next manual login window |
| `DELETE` | `/accounts/{uuid}` | Close and recursively remove a profile only after validating its UUID, directory type and worker metadata |
| `POST` | `/accounts/{uuid}/generate` | Submit a synchronous Muse web task to the already-open Muse account and return one verified result. It does not create a login session. |

Status is `login_required`, `ready`, `verification_required`, `unsupported`, or `error`, with a separate `capabilities:{image,video}`. Muse selectors are based on a public MIT adapter, not on a live verification of this deployment's logged-in account. `ready` only confirms a composer is visible. **It does not confirm an account can generate, a quota remains, or image/video output works.** Doubao login status can be inspected; both Doubao generation capabilities currently remain false and generation returns HTTP 501 `UNSUPPORTED_CAPABILITY` until the visible UI is calibrated and tested.

Generate body:

```json
{
  "provider": "muse",
  "kind": "image",
  "prompt": "A subject in a clear composition",
  "model": "muse-image",
  "referenceImages": ["data:image/png;base64,..."],
  "width": 1024,
  "height": 1024,
  "duration": 5
}
```

`model`, width/height and duration are validated as input metadata; current Muse web submission sends only the prompt and attached reference images because reliable live UI controls for those options have not been verified. Until control selection is implemented and live-tested, callers must communicate that dimensions/duration may not be honored. References must be image data URLs with PNG/JPEG/WebP signatures and are supplied as in-memory upload buffers. Remote URLs, server paths and arbitrary file paths are rejected. Image input permits at most four references; video at most two.

A successful result is a single `{ "base64": "...", "mimeType": "image/png" }` or verified video MIME (`video/mp4` / `video/webm`). The image/video signature is checked from bytes. HTML, JSON and mismatched image/video responses never count as success. A media URL must use HTTPS and resolve through a configured exact hostname allowlist; redirects are revalidated and downloads are bounded by timeout and byte limit. Production network egress must also block private/metadata destinations to protect against DNS rebinding. No upstream URL is sent to the platform browser.

The send attempt is the point where a request may already be accepted. A timeout, verification prompt, browser crash or lost HTTP response afterwards is ambiguous even if no media appears. The API should retain `unknown_external` and reconcile it manually; do not retry with a new account or idempotency key until upstream acceptance is ruled out. Worker timeout defaults to 600 seconds; calling HTTP clients need at least 610 seconds or must treat disconnection as ambiguous.

## Data and capacity

Profiles contain vendor session data and must be protected and backed up like credentials. Store only UUID/provider/state references in MySQL, keep AES-GCM encrypted provider keys separate for the special service-provider account, and never place native browser cookies or worker tokens in Redis or logs. Each account is single-flight. `BROWSER_MAX_CONTEXTS` defaults to two visible contexts and caps between one and eight; this is a local operator/resource setting, not a promise of two successful generations. A 5000-user platform may enqueue work; it must not open 5000 browser contexts.

This package was not run against a real logged-in Muse or Doubao account. No credentials, sign-in, CAPTCHA, quota lookup, or generation were tested. The worker does not assert that browser automation is permitted by either service's current terms; deployment owners must verify their account and use permissions.
