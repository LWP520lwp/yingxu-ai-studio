# Local API contract (v1)

Base URL: `http://localhost:8088/api`. Frontend proxy: `/api`, `/oauth2`, `/login` to `8088`. Override with `APP_PORT` and `FRONTEND_URL`.
Responses are direct JSON objects; list endpoints return arrays. Errors are `{code,message,...}`. Send credentials with every request. JSON field names are camelCase. All timestamps use UTC ISO strings.

All mutation requests (`POST`/`PUT`/`PATCH`/`DELETE`, including local login/logout and multipart upload) must include `X-Workbench-Request: 1`. Browser Origin must exactly match `FRONTEND_URL`; arbitrary CORS is not enabled. This prevents cross-site form/session mutations. CLI calls may omit Origin but still require the custom header.

## Session

- `GET /bootstrap` is public: `{user:null|{id,name,avatarUrl,provider},auth:{githubEnabled,localEnabled,githubLoginUrl:"/oauth2/authorization/github"},models:{image:[],video:[]},skills:[],integration:{name,status,...}}`.

`models.image`/`models.video` are derived from the native browser account pool and the explicit Muse service-key route. The directory includes `muse-image`, `muse-video`, `muse-service-image`, `muse-service-video`, `doubao-image` and `doubao-video`; Doubao remains unavailable until its generation UI is implemented and verified. Each model is `{id,name,provider,available,caps:{supportsReferenceImages,maxReferenceImages,fixedDuration,durations,resolutions,fixedWidth,fixedHeight,supportsSizeControl,watermark,requiresInteractiveVerification}}`. An unavailable route stays listed with `available:false`; a listed model does not prove provider quota or successful generation. Native browser submission currently sends prompt and reference images; requested dimensions and duration are metadata until matching visible controls are implemented and tested. The service-key models use the asynchronous Muse task API.

Doubao image/video do not accept reference assets. Doubao video is fixed to 10 seconds and 1280×720 (720p); incompatible requests fail before submission. These capability rules come from the installed deployment documentation, not a paid generation test. The user completes account login and any verification in a visible browser worker session authorized through the native pool manager.
- `POST /auth/local` creates a local developer session only in the development profile and only through loopback access. Returns the user object. Never enabled in production.
- `GET /oauth2/authorization/github` (outside `/api`) starts GitHub OAuth when configured. `auth.githubLoginUrl` is the canonical absolute login entry derived from `GITHUB_REDIRECT_URI`, so a Vite proxy's rewritten Host cannot change the callback or session host. Development defaults to `http://localhost:${APP_PORT}/login/oauth2/code/github`; production requires an explicit public HTTPS callback without userinfo/query/fragment. Redirects back to the configured frontend URL after authentication.
- `POST /auth/logout` clears the session. Mutation endpoints require a session.

## Projects

- `GET /projects` -> `[{id,title,revision,createdAt,updatedAt}]`.
- `POST /projects` with `{title,document:{...}}` -> project detail, HTTP 201.
- `GET /projects/{id}` -> `{id,title,revision,document:{...},createdAt,updatedAt}`.
- `PUT /projects/{id}` with `{baseRevision:number,title:string,document:{...}}` -> new project detail. A stale revision returns HTTP 409 `{code:"REVISION_CONFLICT",message,currentRevision}`. Documents are arbitrary bounded JSON objects. Every committed revision is retained in MySQL.

### Native canvas engine snapshots

- `GET /projects/{id}/canvas-engine` -> `{projectId,revision,document,updatedAt}`. Before its first save, `revision` is `0` and `document`/`updatedAt` are `null`.
- `PUT /projects/{id}/canvas-engine` with `{baseRevision:number,document:{...}}` -> the same snapshot shape with an independently incremented revision. A stale save returns HTTP 409 `{code:"CANVAS_ENGINE_REVISION_CONFLICT",message,currentRevision}`.
- Both endpoints require the existing platform session and project ownership. PUT also requires the mutation header/origin checks and is rate limited. Responses use `Cache-Control: no-store`.
- The snapshot preserves the native engine's `CanvasProject` JSON, including metadata, groups, chat sessions and unknown extension fields. It validates node/connection identifiers and references, finite geometry, positive dimensions, optional `{x,y,k}` viewport and the existing 2 MiB document limit. It does not convert to the legacy canvas schema or restrict native node types.
- Snapshots live in `project_canvas_engine`, independently of the original project document and its revision. Saving an engine snapshot does not change the legacy document or revision; deleting the project removes its engine snapshot.

## Assets

- `GET /assets?projectId=...` -> array of `{id,projectId,name,mimeType,size,url,createdAt}`.
- `POST /assets` multipart fields `file` and optional `projectId` -> asset object, HTTP 201.
- `GET /assets/{id}/content` streams a session-authorized local file. Asset URLs are same-origin `/api/assets/{id}/content`.

## Generation jobs

- `POST /jobs`, required `Idempotency-Key` header, body `{projectId,nodeId,kind:"image"|"video",prompt,model,width,height,duration,referenceAssetIds:[]}` -> job object, HTTP 202. The same key and same request return the original job. Same key with a different request returns 409. Generation runs outside API threads. Project and input revision are frozen on submit.
- `GET /jobs?projectId=...` -> array of job objects (most recent first).
- `GET /jobs/{id}` -> job object.
- `POST /jobs/{id}/cancel` -> updated job object; cancellation is best effort for upstream work already submitted.
- Job: `{id,status,kind,prompt,model,projectId,nodeId,inputRevision,resultAssetId,resultUrl,error,createdAt,updatedAt}`.
- Status: `queued`, `running`, `waiting_provider`, `succeeded`, `failed`, `cancel_requested`, `cancelled`, `unknown_external`.
- A generated result is a new asset candidate. Jobs never automatically overwrite project documents or newer edits. Frontend applies results through a normal revision-checked project save.
- `GET /events` is an authenticated SSE endpoint. Event types: `ready`, `job`. A `job` event contains the full job object. The connection emits heartbeats. On reconnect, fetch `/jobs` to reconcile durable state.

## Skill market

- `GET /skills` is public and returns the built-in directory. `GET /skills/{id}` adds the declarative `recipe`. Signed-in responses include that user's installation state; anonymous responses have `installed:false`.
- Bootstrap `skills` is produced by this same `SkillService.directory(owner)` method and uses the exact market schema; it no longer contains a separate legacy prompt-template list.
- Skill: `{id,name,author:"映序",description,category,capability:"image"|"video"|"composition",status:"available"|"planned",recipeVersion,tags:[],inputSchema:{...},installationSupported,installed,installedVersion,installedAt,updatedAt,updateAvailable,latestVersion}`.
- `GET /workspace/skills` requires a session and returns only the current user's installed versions, loaded from MySQL. `inputSchema` uses JSON Schema draft 2020-12; it documents recipe inputs, while the existing `/jobs` endpoint remains the authoritative runtime validator.
- `PUT /workspace/skills/{id}` requires a session and body `{recipeVersion:"1.0.0"}`. It idempotently installs or explicitly updates to the current version. A stale version returns 409 `SKILL_VERSION_CHANGED`; a planned capability returns 409 `SKILL_NOT_AVAILABLE`.
- `DELETE /workspace/skills/{id}` idempotently removes only the current user's installation and returns `{ok:true,id,installed:false}`. Mutation requests require the existing custom header/origin checks and are rate limited.
- Available built-ins: `image-create@1.0.0`, `image-to-video@1.0.0`. `storyboard-to-video@0.1.0` is a visible planned composition recipe and cannot be installed or executed.
- Installation only saves a version-pinned personal-workspace association. It does not submit a paid generation, download a package, execute a script, or enable arbitrary remote code. Execution remains an explicit, authorized `/jobs` request and still requires provider configuration. Published definition versions are immutable and retained in MySQL; updating a recipe requires a new version.

## Runtime configuration

Required: MySQL and Redis endpoints; no H2 fallback. Environment: `DB_URL` or `DB_HOST`/`DB_PORT`/`DB_NAME`, `DB_USERNAME`, `DB_PASSWORD`, `REDIS_HOST`, `REDIS_PORT`, optional `REDIS_PASSWORD`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `MUSE_BASE_URL` (default `http://127.0.0.1:18610`), `MUSE_API_KEY`, `FRONTEND_URL` (default `http://localhost:5178`), `APP_STORAGE_ROOT`. GitHub callback is `http://localhost:8088/login/oauth2/code/github`. The upstream web UI on port 3000 is not the generation API. No existing deployment cookies or credentials are copied.

`APP_PROFILE=dev` enables loopback local session; `prod` or `production` disables it even when combined with `dev`. Redis stores HTTP sessions, limits mutation requests, and caches project summaries; MySQL remains the business source of truth. The development scheduler uses MySQL durable jobs with a bounded executor. Runtime reports unavailable upstream capability honestly. The first version does not implement RabbitMQ dispatch or 5000-user acceptance; production scaling remains a separate phase.

The browser account pool requires a separately managed worker at `BROWSER_WORKER_URL` (default `http://127.0.0.1:8091`) and a shared random `BROWSER_WORKER_TOKEN`. The worker must remain bound to loopback and requires the bearer token on every request. `BROWSER_INTERACTIVE_LOGIN_ENABLED` defaults to `false`; enabling it permits an authorized local pool manager to open visible login windows. A special Muse service account can be imported from the configured loopback provider only when `MUSE_LOCAL_KEY_ENABLED=true`, `MUSE_LOCAL_POOL_URL` matches the literal loopback `MUSE_BASE_URL`, and a valid independent `POOL_CREDENTIAL_MASTER_KEY` is configured. The master key is a Base64-encoded 32-byte AES-GCM key. The API stores only authenticated ciphertext; it never returns the provider key. Changing or losing the master key makes stored credentials undecryptable.

Muse adapter: image `POST /v1/images/tasks` with `async:true`, then `GET /v1/images/tasks/{taskId}`. Text video uses JSON `POST /v1/videos`; keyframe video uses multipart `first_frame`/`last_frame` (at most two references). Image references are bounded data URLs. All media is imported into the local authorized asset store; upstream credentials are never sent to the browser. An ambiguous initial submit becomes `unknown_external` and is not automatically replayed. Market skills are declarative versioned recipes, not claims of an implemented autonomous planning agent.

External media downloads require exact trusted CDN hostnames in `MUSE_MEDIA_ALLOWED_HOSTS` (comma-separated, no wildcards). With an empty list, only the configured Muse origin is accepted. Each redirect is checked again; external downloads require HTTPS 443 and non-private addresses, and never receive the Muse bearer key. The production network must additionally block private/metadata destinations at egress, because JDK HttpClient resolves names separately from application validation. Job tracking is capped at two hours, including transient poll/download failures; expiration becomes `unknown_external` without paid resubmission.

## Science video production

- Science drafts are independent of canvas drafts. `GET/PUT /projects/{id}/science` use `{baseRevision,document}` for saving and return `{revision,document,updatedAt}`. Revision conflicts return `SCIENCE_REVISION_CONFLICT`.
- A version 1 document has `topic,title,audience,structure,aspectRatio,sources,scenes` and optional `models:{text,image,video}`. Model IDs never contain credentials. Sources are `{id,title,url,excerpt}`. Scenes are `{id,role,narration,visualPrompt,videoPrompt?,assetId?,videoAssetId?,sourceIds,verified}`; at most 6 scenes and 12 sources. `assetId` is an optional reference image/legacy visual; `videoAssetId` must identify an owned video. Foreign project assets are rejected.
- `POST /projects/{id}/science/plan` with `{document,model?}` returns an unsaved `{document,source,summary}`. Model planning uses only supplied excerpts, proposes up to 6 motion scenes with at most 45 characters of narration per 15-second scene, and always clears user verification. Missing model means source text splitting without invented knowledge. Creators must verify claims and sources before production. AI visuals are illustrations, not scientific evidence or actual experiment records.
- `POST /projects/{id}/science/runs` accepts `{revision,productionMode?,videoModel?,videoDuration?,audioMode?,generateMissingVideos?,voiceId?,generateMissingImages?,imageModel?}`. `productionMode` defaults to `muse_video`, `videoDuration` to 15 (range 5–20), and `audioMode` to `muse_native`. `generateMissingVideos:true` is an explicit authorization to generate missing clips using the configured provider quota. It is not assumed. Missing clips require a video model from the current catalog (`document.models.video` can supply the default). A single scene's narration is limited to `min(45, videoDuration*3)` characters to allow natural speech. The fixed Doubao video model accepts only 10-second 16:9 scenes.
- Dynamic production submits actual `video` jobs with continuous action/process prompts and Chinese native narration requested. It imports and probes the resulting owned video, preserves its original audio, and composes the actual clip durations into an MP4. Images cannot substitute for video segments. Missing native audio fails with a clear error and keeps the obtained video; the server does not silently substitute TTS or a slideshow. The final 4-second reference card is a credit, not a generated scientific scene.
- Native captions are scene-level script drafts (`captionTiming:"scene"`), not speech recognition or verified word timing. Creators must compare them with the generated voice and review scientific fidelity. Existing explicit `productionMode:"image_narration"` retains offline TTS and image composition (`audioMode:"offline_narration"`, `captionTiming:"speech"`); the UI must label it separately.
- `GET /projects/{id}/science/runs` returns `{runs:[...]}`; `GET /projects/{id}/science/runs/{runId}` returns a run. Runs expose `id,revision,status,stage,error,productionMode,videoModel,videoDuration,audioMode,captionTiming,videoJobs,resolvedVideos,imageJobs,resolvedAssets,timeline,resultAssetId/resultUrl,subtitleAssetId/subtitleUrl,narrationAssetId/narrationUrl,createdAt,updatedAt`. Native runs have no separate offline narration asset. Asset URLs require the owning session.
- Run states are `queued,running,waiting_videos,waiting_images,succeeded,failed`. Completed, validated clips are reused only within the same owner's project and exact model/prompt/duration/size/reference-content fingerprint, including after a failed production is retried. Existing active or succeeded identical requests return the original run. Each person may have at most 2 active productions. Source verification is a creator declaration; it is not machine certification.
- `GET /science/capabilities` exposes renderer and offline speech availability plus `defaultProductionMode:"muse_video"`, `productionModes:["muse_video","image_narration"]`, `nativeAudioRequiresValidation:true`, and `nativeCaptionTiming:"scene"`. Native video production requires FFmpeg/ffprobe and an operational video provider; it does not require local TTS.

## Native account pool

`GET /pool/overview` returns aggregate state; `/pool/accounts` provides local owner/admin account management, including visible browser login, status checks, close, enable/disable and loopback service-key import. Access always requires a platform session and loopback client; GitHub authentication alone does not grant host-pool access. Production disables pool management by default. The browser profiles and encrypted service credentials remain host-side. See [POOL_API_CONTRACT.md](POOL_API_CONTRACT.md) for endpoint schemas, permission checks, job routing and worker configuration.
