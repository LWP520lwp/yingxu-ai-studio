# Native account-pool API

Base path: `/api/pool`. Every authenticated platform user can create and manage their own native Muse / Doubao accounts. Account records, browser UUID profiles, status, names, and management actions are private to their platform user ID. A different user's account ID returns 404 before any browser-worker operation. These endpoints do not proxy the old pool's admin interface.

`POOL_OVERVIEW_ENABLED` controls the whole pool feature. Blank follows the profile (`dev` enabled; `prod` and `production` disabled); an explicit `false` disables it. Production operators set it to `true` to enable personal pools. Ordinary GitHub users do not need an administrator role or loopback address for personal management. An unauthenticated request receives 401. Only importing the deployment host's existing service key still requires a loopback request and a local developer identity, configured owner ID, or `ROLE_ADMIN`.

Migration V6 assigns legacy global records only to the existing `local / loopback-developer` identity. If no such identity exists, records retain a null owner and are excluded from personal lists and generation routes; the first GitHub visitor never acquires them. Shared service credentials default to private.

## Overview

`GET /api/pool/overview` returns the current user's aggregate state only and sets `Cache-Control: no-store`. Public service capacity is returned separately in the account snapshot; it is not counted as another user's personal accounts.

```json
{
  "status": "connected",
  "configured": true,
  "accounts": { "total": 1, "available": 1 },
  "doubao": { "total": 1, "available": 0 },
  "browserRunning": true,
  "managementUrl": null,
  "message": "已读取本机账号池状态；账号可用性不代表供应商额度或生成成功",
  "checkedAt": "2026-11-10T00:00:00Z"
}
```

`accounts` includes native Muse and Muse service-credential records; `doubao` includes native Doubao records. `available` counts enabled, ready, unleased accounts, with native browser checks required to be no older than ten minutes. The service credential is counted available only while its stored ciphertext can be decrypted. `browserRunning` reflects authenticated worker health, not an active browser window. `configured` is true when the worker responds or an enabled service credential can be decrypted. Unlike the former external-pool overview, management stays in this application and `managementUrl` is currently null. The overview does not expose account IDs, names, cookies, credentials or recent prompts.

When disabled, `status` is `disabled`, `configured` is false, and counts are `{ "total": null, "available": null }`. Otherwise status is `connected` or `unavailable`. Account counts may be zero; they are database records, not provider quota or generation guarantees.

## Account management

Personal management requires a platform session and returns `POOL_MANAGEMENT_DISABLED` when the pool feature is off. Mutations also require the platform's normal `X-Workbench-Request: 1` and same-origin checks. No endpoint may manage another owner's account, including accounts shared for generation.

- `GET /api/pool/accounts` -> `{accounts:[Account],workerAvailable:boolean,interactiveLoginEnabled:boolean,encryptionReady:boolean,localManagement:true,scope:"personal",canImportLocal:boolean,sharedChannels:{muse:{available:number,busy:number},message:string}}`. `accounts` contains only the requesting user's records; `sharedChannels` contains no account IDs, owner IDs, names or credentials.
- `POST /api/pool/accounts` with `{ "name":"Muse account", "type":"native_muse" | "native_doubao" }` -> new account, HTTP 201. The initial state is `login_required`; names are limited to 120 characters.
- `POST /api/pool/accounts/import-local` with `{ "name":"Muse service" }` -> an encrypted private Muse service account owned by the importing administrator, HTTP 201. Import is allowed only from the configured loopback Muse provider, requires a valid `POOL_CREDENTIAL_MASTER_KEY`, and keeps the deployment-admin checks above. Ordinary users receive 403 `POOL_IMPORT_FORBIDDEN`. The snapshot's `canImportLocal` governs the UI entry.
- `POST /api/pool/accounts/{id}/login` with `{}` -> opens the visible browser login for a native account. It is separately gated by `BROWSER_INTERACTIVE_LOGIN_ENABLED=true`; the human signs in and completes any verification.
- `POST /api/pool/accounts/{id}/check` with `{}` -> reads the current browser session state without opening a browser after worker restart.
- `POST /api/pool/accounts/{id}/close` with `{}` -> closes the visible browser while retaining its profile on disk.
- `PATCH /api/pool/accounts/{id}` with `{ "enabled":true|false, "shared":true|false }` -> updates either or both fields for an account belonging to the requesting user. At least one field is required. Only `muse_service` accepts `shared`; attempting to share a native browser account returns 400. `shared=true` grants logged-in users server-mediated generation access only, never management or plaintext credentials. Disabling or revoking sharing blocks new foreign reservations and future polling reservations; tasks are never replayed on another account.
- `DELETE /api/pool/accounts/{id}` -> soft-disables the account and returns `{ "ok":true, "id":"..." }`. It preserves the audit row and browser profile; it is not profile deletion.

`Account` is `{id,name,type,provider,state,message,enabled,shared,busy,fresh,schedulable,capabilities:{image,video},lastCheckedAt,lastUsedAt,createdAt,updatedAt}`. Supported account types are `native_muse`, `native_doubao` and `muse_service`; `provider` is `muse` or `doubao`. Browser state is `login_required`, `ready`, `verification_required`, `unsupported` or `error`. `busy` reflects the current cross-instance account lease; `fresh` means the last check was within ten minutes. `schedulable` is the authoritative current generation eligibility used by the overview: it also checks the enabled flag, lease, route support, capabilities, authenticated worker health and interactive-login setting, or service-credential decryption. Last-check/use timestamps may be null. The API never returns native browser cookies or the service credential. A `ready` state only reflects the worker's visible composer and does not prove quota or successful generation.

The worker can inspect Doubao login status, but Doubao generation is currently unsupported. Its model entries remain unavailable, and submitting a Doubao job returns `MODEL_UNAVAILABLE`.

## Actual service quota

`Account.quota` and `sharedChannels.muse.quota` contain the following safe quota snapshot:

```json
{
  "status": "available",
  "message": "共享服务额度按账号分别显示",
  "checkedAt": "2026-11-10T00:00:00Z",
  "accounts": [
    {
      "label": "Muse 账号 1",
      "status": "available",
      "plan": null,
      "weeklyUsedPercent": 25,
      "weeklyRemainingPercent": 75,
      "weeklyReset": "11月12日",
      "extraRemaining": "剩余 17 亿个词元",
      "extraUsedPercent": 11,
      "checkedAt": "2026-11-10T00:00:00Z",
      "stale": false
    }
  ]
}
```

This example illustrates the schema; it is not a promise of any deployment's balance. Values come from the configured Muse service's authenticated `/admin/status` account quota cache. An explicit refresh uses its supported `/admin/accounts/{id}/quota` operation to read the provider's quota panel, without submitting a generation. The adapter currently supports a literal loopback Muse service only. It sends each imported account's own decrypted service key, never another user's environment key. The response includes only the whitelisted quota metrics: original supplier IDs/names, cookies, raw settings-page text and service keys are never returned, including in shared snapshots and error messages.

- `status` is `available`, `stale`, `unavailable` or `unsupported`. Native browser routes currently return `unsupported`; service endpoints that do not support quota return `unavailable`.
- Weekly remaining percentage is `100 - weeklyUsedPercent` only when the provider returned a valid 0–100 numeric usage value with `found=true`. Unknown values stay null. Absolute total/used/remaining points and generation counts are not invented from percentages. Each supplier account is displayed separately; percentages and plan quotas are never summed.
- `extraRemaining` retains the provider's human-readable token/credit balance when present. `plan` and `weeklyReset` may be null. Top-level `checkedAt` is the snapshot retrieval time; each account's `checkedAt` is the supplier's actual quota-check time. A missing check time or a check over one hour old is marked `stale`.
- `GET /api/pool/accounts` reads these snapshots, cached for 30 seconds per origin and one-way credential fingerprint. It never automatically opens a quota browser or performs a live refresh. Ordinary reads return the previous snapshot immediately while a live refresh is in progress.
- `POST /api/pool/quota/refresh` with `{}` returns the same complete snapshot as `GET /api/pool/accounts`, with the user's enabled personal service accounts and visible shared service accounts refreshed. Each credential has a 30-second refresh cooldown, and the operation is limited to six requests per platform user per minute. Busy account routes are skipped. Up to eight distinct credentials are considered, with three workers and a 65-second overall refresh budget; the supplier may still return stale/unknown values when login, verification or network access prevents a quota read.
- `POST /api/pool/accounts/{id}/quota` with `{}` refreshes one personally owned service account and returns its updated `Account`. A foreign/shared service account ID still returns 404 before quota work; sharing grants no management permission. A busy account returns `ACCOUNT_BUSY`.
- Both refresh endpoints require the existing authenticated session and same-origin mutation guards and set `Cache-Control: no-store`. Shared service credentials are deduplicated by fingerprint before anonymous quota rows are combined. Revoking sharing immediately removes the corresponding snapshot from foreign users' account responses.

## Models and job routing

`GET /api/bootstrap` publishes the model directory:

- `muse-image` / `muse-video` use a checked, enabled native Muse browser account.
- `muse-service-image` / `muse-service-video` use the imported Muse service credential with the Muse API adapter.
- `doubao-image` / `doubao-video` are listed as unavailable until browser generation is implemented and verified.

Each model carries the normal `{id,name,provider,available,caps}` shape. Availability means a locally configured route and eligible account were found, not that a paid generation, provider quota, or output quality was verified. Native browser generation currently sends prompt and reference images; requested dimensions and duration are metadata until corresponding visible controls are implemented and tested. The service-key route uses the asynchronous Muse task API.

`POST /api/jobs` remains the generation entry point. Models, validation, first reservation, and pinned polling allow the job owner's personal accounts plus explicitly shared `muse_service` accounts. Anonymous bootstrap marks every model unavailable. The selected route and account are pinned to the job at first reservation, so polling cannot silently switch accounts or submit the same task through a different route. Redis SET-NX plus a MySQL lease enforce single-flight use per account, including shared service accounts. Generated assets belong to the submitting platform user, not the service owner. Ambiguous browser submissions and service submissions without a durable upstream task ID become `unknown_external`; they are not automatically replayed. For service jobs with a persisted task ID, transient polling errors remain `waiting_provider` for reconciliation. A cancelled job stops local tracking; an already-submitted provider task may continue.

## Configuration

The API reads these server-side variables from its process environment (the example local environment file is `.env.local`):

- `POOL_OVERVIEW_ENABLED`: deployment-wide feature gate for personal pools. `POOL_OVERVIEW_OWNER_IDS` is a comma-separated platform user ID allowlist for importing the deployment host's local service credential; a `ROLE_ADMIN` is also accepted for that operation, which still requires a loopback client.
- `BROWSER_WORKER_URL`: loopback worker URL, default `http://127.0.0.1:8091`.
- `BROWSER_WORKER_TOKEN`: random secret shared by the API and worker; never expose it through a `VITE_` variable.
- `BROWSER_INTERACTIVE_LOGIN_ENABLED`: defaults to `false`; deployers explicitly enable it on the desktop host that will display website login windows. Opening the window remains separate from personal account creation. A remote user's account record does not make a host desktop window visible on their own device.
- `POOL_CREDENTIAL_MASTER_KEY`: independent Base64-encoded 32-byte AES-GCM key. Keep it in the deployment secret store and back it up separately. Losing or changing it makes existing service credentials undecryptable; it is not generated by the application.
- `MUSE_BASE_URL`, `MUSE_API_KEY`: optional service API route. To import an existing local key, also explicitly enable `MUSE_LOCAL_KEY_ENABLED=true` and set `MUSE_LOCAL_POOL_URL` to the same literal loopback origin as `MUSE_BASE_URL`; this reads the existing `/admin/local-key` value and stores only its encrypted form in `pool_account`.

The separate worker is under `apps/browser-worker`. Keep it bound to `127.0.0.1`, require the shared bearer token on every endpoint, and run it only in the interactive desktop session that owns the persistent profiles. Its own settings, including `BROWSER_PROFILE_ROOT`, are documented in `apps/browser-worker/README.md`. The worker defaults interactive login off. No real provider login, quota lookup, or generation is implied by installation or local fake-endpoint tests.
