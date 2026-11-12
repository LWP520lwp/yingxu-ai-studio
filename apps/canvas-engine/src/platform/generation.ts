import type { AiConfig } from "@/stores/use-config-store";
import i18n from "@/i18n";
import type { ReferenceImage } from "@/types/image";
import {
  imageSizePresets,
  inferVideoRatio,
  parseAspectRatio,
  parsePixelSize,
  readVideoDimensions,
} from "@/lib/media-size";
import { imageToDataUrl } from "@/services/image-storage";
import {
  getPlatformInit,
  platformAbortError,
  platformRequest,
  waitForPlatformInit,
  type PlatformAsset,
  type PlatformRequestOptions,
} from "./rpc";

export type PlatformJob = {
  id: string;
  status:
    | "queued"
    | "running"
    | "waiting_provider"
    | "succeeded"
    | "failed"
    | "cancel_requested"
    | "cancelled"
    | "unknown_external";
  kind: "image" | "video";
  projectId: string;
  nodeId: string;
  resultAssetId?: string | null;
  resultUrl?: string | null;
  error?: string | null;
};
export type PlatformGenerationTask = {
  id: string;
  model: string;
  scopeId: string;
  projectId: string;
};
const terminalFailures = new Set<PlatformJob["status"]>([
  "failed",
  "cancelled",
  "unknown_external",
]);

export function unsupportedGeneration(kind: "text" | "audio"): never {
  throw new Error(
    i18n.t(
      kind === "audio"
        ? "canvas.platformGeneration.audioUnavailable"
        : "canvas.platformGeneration.textUnavailable",
    ),
  );
}

function checkScope(scopeId: string, signal?: AbortSignal) {
  if (signal?.aborted || getPlatformInit()?.scopeId !== scopeId)
    throw platformAbortError();
}

function rawModel(value: string) {
  return value.includes("::") ? value.slice(value.indexOf("::") + 2) : value;
}

function validateSupportedOptions(
  config: AiConfig,
  kind: "image" | "video",
  referenceCount: number,
) {
  const explicit = (value: string) =>
    Boolean(value?.trim() && value.trim() !== "auto");
  if (kind === "image") {
    if (explicit(config.quality))
      throw new Error(
        i18n.t("canvas.platformGeneration.imageQualityUnsupported"),
      );
    if (explicit(config.background))
      throw new Error(
        i18n.t("canvas.platformGeneration.imageBackgroundUnsupported"),
      );
  } else {
    if (explicit(config.videoGenerateAudio))
      throw new Error(
        i18n.t("canvas.platformGeneration.videoAudioUnsupported"),
      );
    if (explicit(config.videoWatermark))
      throw new Error(
        i18n.t("canvas.platformGeneration.videoWatermarkUnsupported"),
      );
    if (
      config.videoMode &&
      !["auto", "reference", "frames"].includes(config.videoMode)
    )
      throw new Error(i18n.t("canvas.platformGeneration.videoModeInvalid"));
    if (
      config.vquality &&
      !/^(?:auto|low|medium|high|[1-9]\d*p?)$/.test(config.vquality)
    )
      throw new Error(
        i18n.t("canvas.platformGeneration.videoResolutionInvalid"),
      );
  }
}

function dimensions(config: AiConfig, kind: "image" | "video") {
  if (
    config.size &&
    config.size !== "auto" &&
    !parsePixelSize(config.size) &&
    !parseAspectRatio(config.size)
  )
    throw new Error(i18n.t("canvas.platformGeneration.sizeInvalid"));
  if (kind === "video")
    return readVideoDimensions(
      config.size,
      config.vquality,
      parseAspectRatio(config.size)
        ? config.size
        : inferVideoRatio(config.size || "16:9"),
    );
  const pixels = parsePixelSize(config.size);
  if (pixels) return pixels;
  const preset = parsePixelSize(imageSizePresets["1k"][config.size] || "");
  if (preset) return preset;
  const ratio = parseAspectRatio(config.size || "1:1");
  if (!ratio) return { width: 1024, height: 1024 };
  const shortSide = 1024;
  return ratio.width >= ratio.height
    ? {
        width: Math.round((shortSide * ratio.width) / ratio.height / 16) * 16,
        height: shortSide,
      }
    : {
        width: shortSide,
        height: Math.round((shortSide * ratio.height) / ratio.width / 16) * 16,
      };
}

async function uploadReferences(
  references: ReferenceImage[],
  scopeId: string,
  options?: PlatformRequestOptions,
) {
  const assetIds: string[] = [];
  for (const reference of references) {
    checkScope(scopeId, options?.signal);
    // Parent asset URLs are already authenticated durable references. Reuse them
    // rather than uploading a second copy of a generated image.
    const durable = /^\/api\/assets\/([^/]+)\/content$/.exec(
      reference.dataUrl || reference.url || "",
    );
    if (
      durable &&
      getPlatformInit()?.assets.some((asset) => asset.id === durable[1])
    ) {
      assetIds.push(durable[1]);
      continue;
    }
    const dataUrl = await imageToDataUrl(reference);
    checkScope(scopeId, options?.signal);
    if (!/^data:image\/(png|jpeg|webp);base64,/i.test(dataUrl))
      throw new Error(
        i18n.t("canvas.platformGeneration.referenceFormatUnsupported"),
      );
    if (dataUrl.length > Math.ceil((4 * 1024 * 1024 * 4) / 3) + 100)
      throw new Error(i18n.t("canvas.platformGeneration.referenceTooLarge"));
    const uploaded = await platformRequest<PlatformAsset>(
      "assets.upload",
      {
        name: reference.name || "reference.png",
        mimeType: reference.type || dataUrl.slice(5, dataUrl.indexOf(";")),
        dataUrl,
      },
      options,
    );
    checkScope(scopeId, options?.signal);
    if (!uploaded?.id)
      throw new Error(
        i18n.t("canvas.platformGeneration.referenceUploadMissingId"),
      );
    assetIds.push(uploaded.id);
  }
  return assetIds;
}

export async function createPlatformGeneration(
  config: AiConfig,
  kind: "image" | "video",
  prompt: string,
  references: ReferenceImage[] = [],
  options?: PlatformRequestOptions,
): Promise<PlatformGenerationTask> {
  if (
    kind === "video" &&
    (config.videoSkillReviewRequired ||
      (!config.videoSkillId && config.appliedSkillId))
  )
    throw new Error(i18n.t("canvas.platformGeneration.skillReviewRequired"));
  const init = await waitForPlatformInit(options);
  checkScope(init.scopeId, options?.signal);
  const model = rawModel(
    config.model || (kind === "video" ? config.videoModel : config.imageModel),
  );
  const declared = init.models[kind].find((item) => item.id === model);
  if (!declared?.available)
    throw new Error(i18n.t("canvas.platformGeneration.modelUnavailable"));
  if (references.length && declared.caps?.supportsReferenceImages === false)
    throw new Error(i18n.t("canvas.platformGeneration.referencesUnsupported"));
  validateSupportedOptions(config, kind, references.length);
  const modes = Array.isArray(declared.caps?.supportedVideoModes)
    ? declared.caps.supportedVideoModes
    : ["auto", "reference"];
  if (kind === "video" && !modes.includes(config.videoMode || "auto"))
    throw new Error(i18n.t("canvas.generation.videoFrameUnsupported"));
  const configuredMaximum = Number(declared.caps?.maxReferenceImages);
  const maximumReferences =
    kind === "video" && config.videoMode === "frames"
      ? Math.min(2, configuredMaximum || 1)
      : Number.isInteger(configuredMaximum)
        ? configuredMaximum
        : kind === "video"
          ? 1
          : 4;
  if (references.length > maximumReferences)
    throw new Error(
      i18n.t("canvas.platformGeneration.tooManyReferences", {
        kind: i18n.t(
          kind === "video"
            ? "canvas.platformGeneration.video"
            : "canvas.platformGeneration.image",
        ),
        count: maximumReferences,
      }),
    );
  if (
    kind === "video" &&
    config.videoMode === "frames" &&
    references.length === 0
  )
    throw new Error(i18n.t("canvas.platformGeneration.firstFrameRequired"));
  if (!prompt.trim())
    throw new Error(i18n.t("canvas.platformGeneration.promptRequired"));
  let preparedPrompt = prompt.trim();
  if (kind === "video" && config.videoSkillId) {
    const prepared = await platformRequest<{
      prompt: string;
      skillId: string;
      skillVersion: string;
    }>(
      "skills.prompt",
      {
        id: config.videoSkillId,
        version: config.videoSkillVersion,
        text: preparedPrompt,
        referenceCount: references.length,
      },
      options,
    );
    checkScope(init.scopeId, options?.signal);
    if (
      prepared.skillId !== config.videoSkillId ||
      prepared.skillVersion !== config.videoSkillVersion ||
      typeof prepared.prompt !== "string" ||
      !prepared.prompt.trim()
    )
      throw new Error(i18n.t("canvas.platformGeneration.skillResultInvalid"));
    preparedPrompt = prepared.prompt;
  }
  const text = config.systemPrompt?.trim()
    ? `${config.systemPrompt.trim()}\n\n${preparedPrompt}`
    : preparedPrompt;
  if (text.length > 12000)
    throw new Error(i18n.t("canvas.platformGeneration.promptTooLong"));
  const { width, height } = dimensions(config, kind);
  if (
    ![width, height].every(
      (value) => Number.isInteger(value) && value >= 64 && value <= 4096,
    )
  )
    throw new Error(i18n.t("canvas.platformGeneration.dimensionsInvalid"));
  const duration = kind === "video" ? Number(config.videoSeconds || 6) : 5;
  if (!Number.isInteger(duration) || duration < 2 || duration > 20)
    throw new Error(i18n.t("canvas.platformGeneration.durationInvalid"));
  const orderedReferences =
    kind === "video" &&
    config.videoMode === "frames" &&
    config.videoFramesReversed
      ? [...references].reverse()
      : references;
  const referenceAssetIds = await uploadReferences(
    orderedReferences,
    init.scopeId,
    options,
  );
  checkScope(init.scopeId, options?.signal);
  const idempotencyKey = crypto.randomUUID();
  const job = await platformRequest<PlatformJob>(
    "jobs.create",
    {
      projectId: init.project.id,
      nodeId: `engine-${idempotencyKey}`,
      kind,
      prompt: text,
      model,
      width,
      height,
      duration,
      referenceAssetIds,
      idempotencyKey,
      ...(kind === "video" ? { videoMode: config.videoMode || "auto" } : {}),
      ...(kind === "video" && config.videoSkillId
        ? {
            skillId: config.videoSkillId,
            skillVersion: config.videoSkillVersion,
          }
        : config.appliedSkillId
          ? {
              skillId: config.appliedSkillId,
              skillVersion: config.appliedSkillVersion,
            }
          : {}),
    },
    options,
  );
  if (!job?.id || job.projectId !== init.project.id || job.kind !== kind)
    throw new Error(i18n.t("canvas.platformGeneration.jobMismatch"));
  const task = {
    id: job.id,
    model,
    scopeId: init.scopeId,
    projectId: init.project.id,
  };
  if (options?.signal?.aborted) {
    void cancelPlatformGeneration(task);
    throw platformAbortError();
  }
  return task;
}

export async function getPlatformGeneration(
  task: PlatformGenerationTask,
  options?: PlatformRequestOptions,
): Promise<PlatformJob> {
  checkScope(task.scopeId, options?.signal);
  const job = await platformRequest<PlatformJob>(
    "jobs.status",
    { id: task.id },
    options,
  );
  checkScope(task.scopeId, options?.signal);
  if (job?.id !== task.id || job.projectId !== task.projectId)
    throw new Error(i18n.t("canvas.platformGeneration.jobWrongProject"));
  return job;
}

export async function cancelPlatformGeneration(task: PlatformGenerationTask) {
  if (getPlatformInit()?.scopeId !== task.scopeId) return;
  try {
    await platformRequest(
      "jobs.cancel",
      { id: task.id },
      { timeoutMs: 15_000 },
    );
  } catch {
    /* Never replace an abort with a second submit or a fabricated result. */
  }
}

export function generationFailure(job: PlatformJob) {
  if (job.status === "unknown_external")
    return (
      job.error || i18n.t("canvas.platformGeneration.externalStatusUnknown")
    );
  if (job.status === "cancelled")
    return job.error || i18n.t("canvas.platformGeneration.jobCancelled");
  return job.error || i18n.t("canvas.platformGeneration.jobFailed");
}

export async function waitForPlatformGeneration(
  task: PlatformGenerationTask,
  options?: PlatformRequestOptions,
) {
  if (options?.signal?.aborted) {
    void cancelPlatformGeneration(task);
    throw platformAbortError();
  }
  const onAbort = () => {
    void cancelPlatformGeneration(task);
  };
  options?.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const deadline = Date.now() + 2 * 60 * 60 * 1000;
    while (Date.now() < deadline) {
      const job = await getPlatformGeneration(task, options);
      if (job.status === "succeeded") {
        if (
          !job.resultUrl ||
          !/^\/api\/assets\/[^/]+\/content$/.test(job.resultUrl)
        )
          throw new Error(i18n.t("canvas.platformGeneration.resultMissing"));
        return job;
      }
      if (terminalFailures.has(job.status))
        throw new Error(generationFailure(job));
      await abortableDelay(2000, options?.signal);
    }
    throw new Error(i18n.t("canvas.platformGeneration.trackingLimitReached"));
  } finally {
    options?.signal?.removeEventListener("abort", onAbort);
  }
}

export function abortableDelay(milliseconds: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(platformAbortError());
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", aborted);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    const aborted = () => {
      clearTimeout(timer);
      cleanup();
      reject(platformAbortError());
    };
    signal?.addEventListener("abort", aborted, { once: true });
  });
}

export async function generatePlatformImages(
  config: AiConfig,
  prompt: string,
  references: ReferenceImage[] = [],
  options?: PlatformRequestOptions,
) {
  const count = Number(config.count || 1);
  if (!Number.isInteger(count) || count < 1 || count > 15)
    throw new Error(i18n.t("canvas.platformGeneration.imageCountInvalid"));
  const results: Array<{ id: string; dataUrl: string }> = [];
  // The platform returns one result per durable job. Each requested result is an
  // explicit independent submission; no automatic replay occurs after an error.
  for (let index = 0; index < count; index += 1) {
    const task = await createPlatformGeneration(
      config,
      "image",
      prompt,
      references,
      options,
    );
    const job = await waitForPlatformGeneration(task, options);
    results.push({ id: job.resultAssetId || job.id, dataUrl: job.resultUrl! });
  }
  return results;
}
