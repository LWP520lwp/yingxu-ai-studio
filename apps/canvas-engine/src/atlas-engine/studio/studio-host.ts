import { getPlatformInit } from "@/platform/rpc";
import { createStoryWorkflowImport } from "@/platform/story-workflow";
import {
  canvasSkillPrompt,
  selectImageModel,
  selectVideoModel,
  videoSkillMetadata,
  type PreparedCanvasSkill,
} from "@/platform/skill-video";
import type { Position } from "@/types/canvas";
import { StudioSession, makeStudioNode, studioId } from "./studio-document";

/** Only the same-origin shell can issue commands, and every command is tied to one document scope. */
export function installStudioHost(options: {
  session: StudioSession;
  projectId: string;
  scopeId: string;
  alive: () => boolean;
  center: () => Position;
  fit: () => void;
  rename: (title: string) => void;
  command: (name: string) => void;
  notice: (message: string) => void;
}) {
  const { session } = options;
  const applied = new Map<
    string,
    { ok: boolean; result?: unknown; error?: { message: string } }
  >();
  const receive = (event: MessageEvent) => {
    const message = event.data;
    if (
      !options.alive() ||
      event.source !== parent ||
      event.origin !== location.origin ||
      !message ||
      typeof message !== "object" ||
      message.type !== "frameflow:command" ||
      message.scopeId !== options.scopeId
    )
      return;
    const payload = message.payload;
    if (message.command === "rename" && typeof payload?.title === "string")
      options.rename(payload.title.slice(0, 200));
    if (message.command === "openConfig") options.command("settings");
    if (message.command === "openAgent" || message.command === "agent")
      options.command("codex");
    if (message.command === "storyWorkflow") {
      const id =
        typeof message.id === "string" &&
        message.id.length > 0 &&
        message.id.length <= 128
          ? message.id
          : null;
      if (!id) return;
      let response = applied.get(id);
      if (!response) {
        try {
          const init = getPlatformInit();
          if (
            !init ||
            init.scopeId !== options.scopeId ||
            init.project.id !== options.projectId
          )
            return;
          const batch = createStoryWorkflowImport(
            payload,
            session.read().nodes,
            init.models,
            options.center(),
          );
          if (!batch.duplicate) session.insert(batch.nodes, batch.connections);
          session.select(batch.selectedIds);
          options.fit();
          response = {
            ok: true,
            result: {
              applied: !batch.duplicate,
              duplicate: batch.duplicate,
              warnings: batch.warnings,
            },
          };
        } catch (reason) {
          response = {
            ok: false,
            error: {
              message:
                reason instanceof Error ? reason.message : "分镜导入失败",
            },
          };
        }
        applied.set(id, response);
        if (applied.size > 100) applied.delete(applied.keys().next().value!);
      }
      parent.postMessage(
        {
          type: "frameflow:command-response",
          scopeId: options.scopeId,
          id,
          command: "storyWorkflow",
          ...response,
        },
        location.origin,
      );
    }
    if (
      (message.command === "insert" || message.command === "skill") &&
      payload &&
      typeof payload === "object"
    ) {
      try {
        const init = getPlatformInit();
        if (!init) return;
        const video = payload.kind === "video";
        const prompt = canvasSkillPrompt(payload);
        const source = session
          .read()
          .nodes.find(
            (node) =>
              session.snapshot().selection.has(node.id) &&
              node.type === "image",
          );
        const model = video
          ? selectVideoModel(
              init.models.video,
              payload.defaults?.model,
              undefined,
              payload.requiresReference === true,
            )
          : selectImageModel(
              init.models.image,
              payload.defaults?.model,
              undefined,
              payload.requiresReference === true,
            );
        const point = options.center();
        const title =
          typeof payload.title === "string"
            ? payload.title
            : video
              ? "视频创作"
              : "图像创作";
        const url =
          typeof payload.url === "string" &&
          /^\/api\/assets\/[^/]+\/content(?:\?.*)?$/.test(payload.url)
            ? payload.url
            : "";
        const prepared: PreparedCanvasSkill = {
          kind: video ? "video" : "image",
          defaults: payload.defaults || {},
          requiresReference: payload.requiresReference === true,
        };
        const metadata =
          video && model
            ? videoSkillMetadata(prepared, model, undefined, prompt)
            : {
                generationMode: video ? ("video" as const) : ("image" as const),
                prompt,
                composerContent: prompt,
                model: model ? `platform::${model.id}` : "",
                skillId: payload.defaults?.skillId,
                skillVersion: payload.defaults?.skillVersion,
                ...(Number.isFinite(payload.defaults?.width) &&
                payload.defaults.width > 0 &&
                Number.isFinite(payload.defaults?.height) &&
                payload.defaults.height > 0
                  ? {
                      size: `${payload.defaults.width}x${payload.defaults.height}`,
                    }
                  : {}),
              };
        const node = makeStudioNode(
          url ? (video ? "video" : "image") : "config",
          point.x - 180,
          point.y - 120,
          title,
          {
            ...metadata,
            ...(url ? { content: url, status: "success" as const } : {}),
          },
        );
        session.insert(
          [node],
          source
            ? [{ id: studioId(), fromNodeId: source.id, toNodeId: node.id }]
            : [],
        );
      } catch (reason) {
        options.notice(
          reason instanceof Error ? reason.message : "素材未能插入",
        );
      }
    }
  };
  window.addEventListener("message", receive);
  return () => {
    applied.clear();
    window.removeEventListener("message", receive);
  };
}
