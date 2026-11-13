import i18n from "@/i18n";
import {
  getPlatformInit,
  platformRequest,
  type PlatformAsset,
  type PlatformInit,
} from "@/platform/rpc";
import {
  cancelPlatformGeneration,
  createPlatformGeneration,
  getPlatformGeneration,
  waitForPlatformGeneration,
  type PlatformGenerationTask,
} from "@/platform/generation";
import {
  buildNodeGenerationContext,
  frameReferenceIssue,
  type hydrateNodeGenerationContext,
} from "@/atlas-engine/workflows/node-generation-context";
import { buildAtlasGenerationConfig } from "@/atlas-engine/workflows/generation-runtime";
import { readImageMeta } from "@/lib/image-utils";
import type { AiConfig } from "@/stores/use-config-store";
import {
  CanvasNodeType,
  type CanvasGenerationMode,
  type CanvasNodeData,
  type CanvasNodeMetadata,
} from "@/types/canvas";
import type { StudioPort } from "./studio-document";
export type { StudioPort } from "./studio-document";

type JobKind = "image" | "video";
type Run = {
  source: string;
  outputs: string[];
  scope: string;
  controller: AbortController;
  tasks: Set<PlatformGenerationTask>;
};

export type StudioTaskDependencies = {
  init(): PlatformInit | null;
  prepare: typeof buildNodeGenerationContext;
  hydrate: typeof hydrateNodeGenerationContext;
  configuration: typeof buildAtlasGenerationConfig;
  create: typeof createPlatformGeneration;
  wait: typeof waitForPlatformGeneration;
  status: typeof getPlatformGeneration;
  cancel: typeof cancelPlatformGeneration;
  assets(signal: AbortSignal): Promise<PlatformAsset[]>;
  dimensions: typeof readImageMeta;
  id(): string;
};

const production: StudioTaskDependencies = {
  init: getPlatformInit,
  prepare: buildNodeGenerationContext,
  // The platform resolves local storage references and reuses durable asset URLs.
  hydrate: async (context) => context,
  configuration: buildAtlasGenerationConfig,
  create: createPlatformGeneration,
  wait: waitForPlatformGeneration,
  status: getPlatformGeneration,
  cancel: cancelPlatformGeneration,
  assets: (signal) => platformRequest("assets.list", {}, { signal }),
  dimensions: readImageMeta,
  id: () => crypto.randomUUID(),
};

const words = (zh: string, en: string) =>
  i18n.language.startsWith("zh") ? zh : en;
const abort = () =>
  new DOMException("Canvas task context expired", "AbortError");
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** A controller owns its project for its entire lifetime. No request can migrate between projects. */
export function createStudioTasks(
  port: StudioPort,
  getConfig: () => AiConfig,
  dependencies: Partial<StudioTaskDependencies> = {},
) {
  const io = { ...production, ...dependencies };
  const owners = new Map<string, Run>();
  let disposed = false;

  function valid(run: Run) {
    return (
      !disposed &&
      port.alive() &&
      !run.controller.signal.aborted &&
      io.init()?.scopeId === run.scope &&
      owners.get(run.source) === run &&
      port.read().nodes.some((node) => node.id === run.source)
    );
  }

  function assert(run: Run, output?: string) {
    if (
      !valid(run) ||
      (output && !port.read().nodes.some((node) => node.id === output))
    )
      throw abort();
  }

  function patch(id: string, metadata: CanvasNodeMetadata) {
    port.change(
      (document) => ({
        ...document,
        nodes: document.nodes.map((node) =>
          node.id === id
            ? { ...node, metadata: { ...node.metadata, ...metadata } }
            : node,
        ),
      }),
      false,
    );
  }

  function report(error: unknown) {
    if (!disposed && port.alive()) port.notice(errorMessage(error));
  }

  async function retireTerminalTask(
    task: PlatformGenerationTask,
    nodeIds: readonly string[],
  ) {
    const current = () =>
      !disposed &&
      port.alive() &&
      io.init()?.scopeId === task.scopeId &&
      io.init()?.project.id === task.projectId;
    if (!current()) return;
    try {
      // A rejected poll can mean a lost connection. Only an authoritative
      // terminal status makes this node eligible for a fresh submission.
      const job = await io.status(task, { timeoutMs: 15_000 });
      if (
        !current() ||
        job.id !== task.id ||
        job.projectId !== task.projectId ||
        (job.status !== "failed" && job.status !== "cancelled")
      )
        return;
      const ids = new Set(nodeIds);
      port.change(
        (document) => ({
          ...document,
          nodes: document.nodes.map((node) =>
            ids.has(node.id) && node.metadata?.videoTaskId === task.id
              ? {
                  ...node,
                  metadata: {
                    ...node.metadata,
                    videoTaskId: undefined,
                    videoTaskProjectId: undefined,
                    videoTaskProvider: undefined,
                  },
                }
              : node,
          ),
        }),
        false,
      );
    } catch {
      /* Preserve the ID when external status cannot be confirmed. */
    }
  }

  function cancel(
    task: PlatformGenerationTask,
    nodeIds: readonly string[] = [],
  ) {
    void io
      .cancel(task)
      .then(() =>
        nodeIds.length ? retireTerminalTask(task, nodeIds) : undefined,
      )
      .catch(() => undefined);
  }

  function stop(nodeId: string) {
    for (const run of owners.values()) {
      if (run.source !== nodeId && !run.outputs.includes(nodeId)) continue;
      run.controller.abort();
      for (const task of run.tasks) cancel(task, run.outputs);
      if (!disposed && port.alive() && io.init()?.scopeId === run.scope) {
        const owned = new Set([run.source, ...run.outputs]);
        port.change(
          (document) => ({
            ...document,
            nodes: document.nodes.map((node) =>
              owned.has(node.id) && node.metadata?.status === "loading"
                ? {
                    ...node,
                    metadata: {
                      ...node.metadata,
                      status: node.metadata.content ? "success" : "idle",
                      errorDetails: undefined,
                    },
                  }
                : node,
            ),
          }),
          false,
        );
      }
      owners.delete(run.source);
    }
  }

  async function finishOutput(
    run: Run,
    outputId: string,
    task: PlatformGenerationTask,
    kind: JobKind,
  ) {
    assert(run, outputId);
    run.tasks.add(task);
    if (kind === "video")
      patch(outputId, {
        videoTaskId: task.id,
        videoTaskProjectId: task.projectId,
        videoTaskProvider: "platform",
        model: `platform::${task.model}`,
      });
    try {
      const job = await io.wait(task, { signal: run.controller.signal });
      assert(run, outputId);
      const assets = await io.assets(run.controller.signal);
      assert(run, outputId);
      const asset = assets.find((entry) => entry.id === job.resultAssetId);
      if (
        !asset ||
        !asset.mimeType.startsWith(`${kind}/`) ||
        !job.resultUrl ||
        !/^\/api\/assets\/[^/]+\/content$/.test(job.resultUrl)
      ) {
        throw new Error(
          words(
            "生成结果尚未返回有效素材，请在生成记录核对任务。",
            "The task has no verified media asset yet. Check generation history.",
          ),
        );
      }
      const dimensions =
        kind === "image" ? await io.dimensions(job.resultUrl) : null;
      assert(run, outputId);
      port.change(
        (document) => ({
          ...document,
          nodes: document.nodes.map((node) => {
            if (
              node.id !== outputId ||
              (kind === "video" && node.metadata?.videoTaskId !== task.id)
            )
              return node;
            const width =
              dimensions?.width || node.metadata?.naturalWidth || 1280;
            const height =
              dimensions?.height || node.metadata?.naturalHeight || 720;
            const ratio = Math.min(1, 420 / width, 360 / height);
            return {
              ...node,
              width: Math.round(width * ratio),
              height: Math.max(100, Math.round(height * ratio)),
              metadata: {
                ...node.metadata,
                content: job.resultUrl!,
                mimeType: asset.mimeType,
                bytes: asset.size,
                naturalWidth: width,
                naturalHeight: height,
                status: "success",
                errorDetails: undefined,
                videoTaskId: undefined,
              },
            };
          }),
        }),
        false,
      );
    } catch (error) {
      if (kind === "video" && valid(run))
        await retireTerminalTask(task, [outputId]);
      throw error;
    } finally {
      run.tasks.delete(task);
    }
  }

  async function contextFor(
    source: CanvasNodeData,
    mode: JobKind,
    prompt: string,
    config: AiConfig,
  ) {
    const document = port.read();
    const context = io.prepare(
      source.id,
      document.nodes,
      document.connections,
      prompt,
      { frameMode: mode === "video" && config.videoMode === "frames" },
    );
    if (
      source.type === CanvasNodeType.Image &&
      source.metadata?.content &&
      !context.referenceImages.some((image) => image.id === source.id)
    ) {
      context.referenceImages.push({
        id: source.id,
        name: source.title,
        type: source.metadata.mimeType || "image/png",
        dataUrl: source.metadata.content,
        storageKey: source.metadata.storageKey,
      });
      context.imageCount = context.referenceImages.length;
    }
    if (context.referenceVideos.length || context.referenceAudios.length) {
      throw new Error(
        words(
          "当前通道支持文字与图片参考，请移除视频或音频参考后再提交。",
          "This channel accepts text and image references. Remove video or audio references before submitting.",
        ),
      );
    }
    if (mode === "video" && config.videoMode === "frames") {
      const issue = frameReferenceIssue(context.referenceImages.length);
      if (issue) throw new Error(issue);
    }
    return context;
  }

  async function resumeNode(source: CanvasNodeData): Promise<void> {
    const init = io.init();
    if (
      !init ||
      !port.alive() ||
      disposed ||
      owners.has(source.id) ||
      !source.metadata?.videoTaskId
    )
      return;
    if (
      source.metadata.videoTaskProjectId &&
      source.metadata.videoTaskProjectId !== init.project.id
    ) {
      patch(source.id, {
        status: "error",
        errorDetails: words(
          "任务所属项目与当前草稿不同，未恢复追踪。",
          "This task belongs to a different project and was not resumed.",
        ),
      });
      return;
    }
    const run: Run = {
      source: source.id,
      outputs: [source.id],
      scope: init.scopeId,
      controller: new AbortController(),
      tasks: new Set(),
    };
    owners.set(source.id, run);
    patch(source.id, { status: "loading", errorDetails: undefined });
    try {
      await finishOutput(
        run,
        source.id,
        {
          id: source.metadata.videoTaskId,
          model: (source.metadata.model || "").replace(/^platform::/, ""),
          projectId: init.project.id,
          scopeId: init.scopeId,
        },
        "video",
      );
    } catch (error) {
      if (valid(run)) {
        patch(source.id, {
          status: "error",
          errorDetails: errorMessage(error),
        });
        report(error);
      }
    } finally {
      if (owners.get(source.id) === run) owners.delete(source.id);
    }
  }

  async function generate(
    nodeId: string,
    mode: CanvasGenerationMode,
    instruction: string,
  ): Promise<void> {
    if (disposed || !port.alive() || owners.has(nodeId)) return;
    const init = io.init();
    const source = port.read().nodes.find((node) => node.id === nodeId);
    if (!init || !source) return;
    if (mode !== "image" && mode !== "video") {
      port.notice(
        words(
          "此生成通道尚未接入文本或音频生成。可使用 Codex 整理文字，或上传已有音频。",
          "This channel does not provide text or audio generation. Use Codex for writing, or upload an audio file.",
        ),
      );
      return;
    }
    if (
      mode === "video" &&
      source.metadata?.videoTaskId &&
      !source.metadata.content
    )
      return resumeNode(source);
    if (mode === "video") {
      const outputs = new Set(
        port
          .read()
          .connections.filter((edge) => edge.fromNodeId === source.id)
          .map((edge) => edge.toNodeId),
      );
      const pending = port
        .read()
        .nodes.find(
          (node) =>
            outputs.has(node.id) &&
            node.type === CanvasNodeType.Video &&
            node.metadata?.videoTaskId &&
            !node.metadata.content,
        );
      if (pending) return resumeNode(pending);
    }
    const prompt =
      instruction.trim() ||
      source.metadata?.composerContent?.trim() ||
      source.metadata?.prompt?.trim() ||
      (source.type === CanvasNodeType.Text
        ? source.metadata?.content?.trim()
        : "") ||
      "";
    if (!prompt) {
      port.notice(
        words(
          "先写下本次生成的画面与动作要求。",
          "Describe the scene and action before generating.",
        ),
      );
      return;
    }
    const config = io.configuration(getConfig(), source, mode);
    const run: Run = {
      source: nodeId,
      outputs: [],
      scope: init.scopeId,
      controller: new AbortController(),
      tasks: new Set(),
    };
    owners.set(nodeId, run);
    const previousStatus = source.metadata?.status;
    try {
      const context = await contextFor(source, mode, prompt, config);
      assert(run);
      const hydrated = await io.hydrate(context, {
        signal: run.controller.signal,
      });
      assert(run);
      const count =
        mode === "image"
          ? Math.min(4, Math.max(1, Math.floor(Number(config.count) || 1)))
          : 1;
      const outputs = Array.from(
        { length: count },
        (_, index): CanvasNodeData => ({
          id: `studio-output-${io.id()}`,
          type: mode === "image" ? CanvasNodeType.Image : CanvasNodeType.Video,
          title: `${source.title || words("创作", "Creation")} · ${mode === "image" ? words("图像", "Image") : words("视频", "Video")}${count > 1 ? ` ${index + 1}` : ""}`,
          position: {
            x: source.position.x + source.width + 140,
            y: source.position.y + index * 320,
          },
          width: 360,
          height: mode === "image" ? 280 : 204,
          metadata: {
            status: "loading",
            generationMode: mode,
            prompt,
            model: config.model,
            size: config.size,
            seconds: config.videoSeconds,
            videoMode: config.videoMode,
            videoFramesReversed: config.videoFramesReversed,
            videoSkillId: config.videoSkillId,
            videoSkillVersion: config.videoSkillVersion,
            videoSkillInputMode: "instruction",
            skillId: config.appliedSkillId,
            skillVersion: config.appliedSkillVersion,
            references: hydrated.referenceImages.map(
              (image) => image.storageKey || image.dataUrl,
            ),
          },
        }),
      );
      run.outputs = outputs.map((node) => node.id);
      patch(nodeId, { status: "loading", errorDetails: undefined });
      port.insert(
        outputs,
        outputs.map((output) => ({
          id: `studio-edge-${io.id()}`,
          fromNodeId: nodeId,
          toNodeId: output.id,
        })),
      );
      let cursor = 0;
      let succeeded = 0;
      let firstError = "";
      const worker = async () => {
        while (cursor < outputs.length) {
          const output = outputs[cursor++];
          try {
            assert(run, output.id);
            const task = await io.create(
              config,
              mode,
              hydrated.prompt,
              hydrated.referenceImages,
              { signal: run.controller.signal },
            );
            if (!valid(run)) {
              cancel(task);
              throw abort();
            }
            await finishOutput(run, output.id, task, mode);
            succeeded++;
          } catch (error) {
            if (!valid(run)) return;
            firstError ||= errorMessage(error);
            patch(output.id, {
              status: "error",
              errorDetails: errorMessage(error),
            });
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(2, outputs.length) }, worker),
      );
      if (valid(run)) {
        patch(nodeId, {
          status: succeeded
            ? source.metadata?.content
              ? "success"
              : "idle"
            : "error",
          errorDetails: succeeded ? undefined : firstError,
        });
        port.notice(
          succeeded
            ? words(
                `已完成 ${succeeded}/${outputs.length} 个结果。`,
                `${succeeded}/${outputs.length} results completed.`,
              )
            : firstError,
        );
      }
    } catch (error) {
      if (valid(run)) {
        patch(nodeId, {
          status: previousStatus || "idle",
          errorDetails: errorMessage(error),
        });
        report(error);
      }
    } finally {
      if (owners.get(nodeId) === run) {
        if (!disposed && port.alive() && io.init()?.scopeId === run.scope) {
          const pending = new Set(run.outputs);
          port.change(
            (document) => ({
              ...document,
              nodes: document.nodes.map((node) =>
                pending.has(node.id) && node.metadata?.status === "loading"
                  ? { ...node, metadata: { ...node.metadata, status: "idle" } }
                  : node,
              ),
            }),
            false,
          );
        }
        owners.delete(nodeId);
      }
    }
  }

  return {
    generate,
    stop,
    isRunning: (nodeId: string) =>
      [...owners.values()].some(
        (run) =>
          !run.controller.signal.aborted &&
          (run.source === nodeId || run.outputs.includes(nodeId)),
      ),
    resume() {
      if (!disposed && port.alive())
        for (const node of port.read().nodes) {
          if (
            node.type === CanvasNodeType.Video &&
            node.metadata?.videoTaskId &&
            !node.metadata.content
          )
            void resumeNode(node);
        }
    },
    dispose() {
      disposed = true;
      for (const run of owners.values()) {
        run.controller.abort();
        for (const task of run.tasks) cancel(task);
      }
      owners.clear();
    },
  };
}
