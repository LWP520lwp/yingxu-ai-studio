import { describe, expect, it, vi } from "vitest";
import { createStudioTasks, type StudioTaskDependencies } from "@/atlas-engine/studio/studio-tasks";
import type { StudioDocument, StudioPort } from "@/atlas-engine/studio/studio-document";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { AiConfig } from "@/stores/use-config-store";
import type { PlatformInit } from "./rpc";
import type { PlatformGenerationTask } from "./generation";

vi.mock("@/lib/localforage-storage", () => ({
  localForageStorage: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined },
  createScopedStorage: () => ({ getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(patch: Partial<AiConfig> = {}, sourcePatch: Partial<CanvasNodeData> = {}) {
  const source: CanvasNodeData = { id: "source", type: CanvasNodeType.Config, title: "镜头方案", position: { x: 20, y: 40 }, width: 360, height: 240, metadata: {}, ...sourcePatch };
  let document: StudioDocument = { nodes: [source], connections: [], viewport: { x: 0, y: 0, k: 1 }, backgroundMode: "dots", showImageInfo: false };
  let active = true;
  let init: PlatformInit = { scopeId: "scope", userId: "user", project: { id: "project", title: "草稿" }, baseCanvasDocument: {}, snapshot: null, models: { image: [], video: [] }, assets: [] };
  const notice = vi.fn();
  const port: StudioPort = {
    read: () => document,
    change: (recipe) => { document = recipe(document); },
    insert: (nodes, connections = []) => { document = { ...document, nodes: [...document.nodes, ...nodes], connections: [...document.connections, ...connections] }; },
    alive: () => active, notice,
  };
  let sequence = 0;
  const config = { model: "platform::image", count: "1", videoMode: "auto", ...patch } as AiConfig;
  const create = vi.fn<StudioTaskDependencies["create"]>(async () => ({ id: `task-${++sequence}`, model: "model", scopeId: "scope", projectId: "project" }));
  const wait = vi.fn<StudioTaskDependencies["wait"]>(async (task) => ({ id: task.id, kind: "image", projectId: "project", nodeId: "source", status: "succeeded", resultAssetId: task.id, resultUrl: `/api/assets/${task.id}/content` }));
  const cancel = vi.fn<StudioTaskDependencies["cancel"]>(async () => undefined);
  const status = vi.fn<StudioTaskDependencies["status"]>(async task => ({ id: task.id, kind: "video", projectId: "project", nodeId: "source", status: "failed" }));
  const io: Partial<StudioTaskDependencies> = {
    init: () => init,
    configuration: () => config,
    hydrate: async (context) => context,
    create, wait, cancel, status,
    assets: async () => Array.from({ length: sequence }, (_, index) => ({ id: `task-${index + 1}`, url: `/api/assets/task-${index + 1}/content`, name: "result", mimeType: "image/png", size: 24 })),
    dimensions: async () => ({ width: 1280, height: 720, mimeType: "image/png" }),
    id: () => String(++sequence),
  };
  return { port, source, config, io, notice, create, wait, cancel, status, read: () => document,
    change: (recipe: (value: StudioDocument) => StudioDocument) => { document = recipe(document); },
    scope: (scopeId: string) => { init = { ...init, scopeId }; }, close: () => { active = false; } };
}

describe("independent studio generation controller", () => {
  it("locks duplicate submissions and passes durable references without hydration uploads", async () => {
    const f = fixture({}, { type: CanvasNodeType.Image, metadata: { content: "/api/assets/source-image/content", mimeType: "image/png" } });
    const gate = deferred<PlatformGenerationTask>();
    f.create.mockReturnValueOnce(gate.promise);
    const tasks = createStudioTasks(f.port, () => f.config, f.io);
    const first = tasks.generate("source", "image", "让人物回头");
    await vi.waitFor(() => expect(f.create).toHaveBeenCalledOnce());
    await tasks.generate("source", "image", "重复点击");
    expect(f.create).toHaveBeenCalledOnce();
    expect(f.create.mock.calls[0][3]).toMatchObject([{ id: "source", dataUrl: "/api/assets/source-image/content" }]);
    gate.resolve({ id: "task-1", model: "model", scopeId: "scope", projectId: "project" });
    await first;
    expect(tasks.isRunning("source")).toBe(false);
  });

  it("keeps successful batch results when another provider task fails", async () => {
    const f = fixture({ count: "3" });
    f.wait.mockImplementation(async (task) => {
      return { id: task.id, kind: "image", projectId: "project", nodeId: "source", status: "succeeded", resultAssetId: task.id, resultUrl: `/api/assets/${task.id}/content` };
    });
    f.wait.mockRejectedValueOnce(new Error("one failed"));
    const tasks = createStudioTasks(f.port, () => f.config, f.io);
    await tasks.generate("source", "image", "雨夜街景");
    const outputs = f.read().nodes.filter((node) => node.id !== "source");
    expect(outputs).toHaveLength(3);
    expect(outputs.filter((node) => node.metadata?.status === "success")).toHaveLength(2);
    expect(outputs.filter((node) => node.metadata?.status === "error")).toHaveLength(1);
    expect(f.read().connections).toHaveLength(3);
    expect(f.source.metadata?.content).toBeUndefined();
  });

  it("releases a stopped owner immediately and prevents late results from changing a new run", async () => {
    const f = fixture();
    const gate = deferred<PlatformGenerationTask>();
    f.create.mockReturnValueOnce(gate.promise);
    const tasks = createStudioTasks(f.port, () => f.config, f.io);
    const first = tasks.generate("source", "video", "人物走进门");
    await vi.waitFor(() => expect(f.create).toHaveBeenCalledOnce());
    tasks.stop("source");
    expect(tasks.isRunning("source")).toBe(false);
    await tasks.generate("source", "image", "新的图片");
    expect(f.create).toHaveBeenCalledTimes(2);
    const before = structuredClone(f.read());
    gate.resolve({ id: "late", model: "model", scopeId: "scope", projectId: "project" });
    await first;
    expect(f.cancel).toHaveBeenCalledWith(expect.objectContaining({ id: "late" }));
    expect(f.read()).toEqual(before);
  });

  it("does not insert outputs after the project scope changes during preparation", async () => {
    const f = fixture();
    const gate = deferred<Awaited<ReturnType<StudioTaskDependencies["hydrate"]>>>();
    let context: Awaited<ReturnType<StudioTaskDependencies["hydrate"]>> | undefined;
    f.io.hydrate = async (value) => { context = value; return gate.promise; };
    const tasks = createStudioTasks(f.port, () => f.config, f.io);
    const work = tasks.generate("source", "image", "草稿一");
    await vi.waitFor(() => expect(context).toBeDefined());
    f.scope("other-scope"); gate.resolve(context!); await work;
    expect(f.read().nodes).toHaveLength(1);
    expect(f.create).not.toHaveBeenCalled();
  });

  it("resumes a persisted video task only once without resubmitting generation", async () => {
    const f = fixture({}, { type: CanvasNodeType.Video, metadata: { videoTaskId: "saved-task", videoTaskProjectId: "project", model: "platform::video" } });
    const gate = deferred<Awaited<ReturnType<StudioTaskDependencies["wait"]>>>();
    f.wait.mockReturnValue(gate.promise);
    f.io.assets = async () => [{ id: "saved-result", url: "/api/assets/saved-result/content", name: "video", mimeType: "video/mp4", size: 100 }];
    const tasks = createStudioTasks(f.port, () => f.config, f.io);
    tasks.resume(); tasks.resume();
    expect(f.wait).toHaveBeenCalledOnce();
    expect(f.create).not.toHaveBeenCalled();
    gate.resolve({ id: "saved-task", kind: "video", projectId: "project", nodeId: "source", status: "succeeded", resultAssetId: "saved-result", resultUrl: "/api/assets/saved-result/content" });
    await vi.waitFor(() => expect(tasks.isRunning("source")).toBe(false));
    expect(f.read().nodes[0].metadata).toMatchObject({ content: "/api/assets/saved-result/content", status: "success" });
    expect(f.read().nodes[0].metadata?.videoTaskId).toBeUndefined();
  });

  it("rejects missing first frames before creating an output or provider task", async () => {
    const f = fixture({ videoMode: "frames" });
    const tasks = createStudioTasks(f.port, () => f.config, f.io);
    await tasks.generate("source", "video", "首尾帧过渡");
    expect(f.create).not.toHaveBeenCalled();
    expect(f.read().nodes).toHaveLength(1);
    expect(f.notice).toHaveBeenCalled();
  });

  it("allows a user-confirmed retry after a provider has conclusively failed", async () => {
    const f = fixture(); f.wait.mockRejectedValue(new Error("provider failed"));
    const tasks = createStudioTasks(f.port, () => f.config, f.io);
    await tasks.generate("source", "video", "人物向前走");
    const output = f.read().nodes.find(node => node.type === CanvasNodeType.Video)!;
    expect(output.metadata?.status).toBe("error");
    expect(output.metadata?.videoTaskId).toBeUndefined();
    expect(f.create).toHaveBeenCalledOnce();
    expect(f.status).toHaveBeenCalledOnce();
    await tasks.generate("source", "video", "重新生成");
    expect(f.create).toHaveBeenCalledTimes(2);
  });

  it("retires a stopped task only after the server confirms its cancellation", async () => {
    const f = fixture(); const gate = deferred<Awaited<ReturnType<StudioTaskDependencies["wait"]>>>();
    f.wait.mockReturnValueOnce(gate.promise);
    f.status.mockImplementation(async task => ({ id: task.id, kind: "video", projectId: "project", nodeId: "source", status: "cancelled" }));
    const tasks = createStudioTasks(f.port, () => f.config, f.io);
    const work = tasks.generate("source", "video", "人物挥手");
    await vi.waitFor(() => expect(f.wait).toHaveBeenCalledOnce());
    const outputId = f.read().nodes.find(node => node.type === CanvasNodeType.Video)!.id;
    expect(f.read().nodes.find(node => node.id === outputId)?.metadata?.videoTaskId).toBeTruthy();
    tasks.stop(outputId);
    await vi.waitFor(() => expect(f.read().nodes.find(node => node.id === outputId)?.metadata?.videoTaskId).toBeUndefined());
    gate.reject(new DOMException("cancelled", "AbortError")); await work;
    await tasks.generate(outputId, "video", "重试人物挥手");
    expect(f.create).toHaveBeenCalledTimes(2);
  });

  it("preserves unknown external tasks and queries them from either source or output without resubmitting", async () => {
    const f = fixture(); f.wait.mockRejectedValue(new Error("external status unknown"));
    f.status.mockImplementation(async task => ({ id: task.id, kind: "video", projectId: "project", nodeId: "source", status: "unknown_external" }));
    const tasks = createStudioTasks(f.port, () => f.config, f.io);
    await tasks.generate("source", "video", "人物走进门");
    const output = f.read().nodes.find(node => node.type === CanvasNodeType.Video)!;
    const taskId = output.metadata?.videoTaskId;
    expect(taskId).toBeTruthy();
    await tasks.generate("source", "video", "再试一次");
    await tasks.generate(output.id, "video", "再试一次");
    expect(f.create).toHaveBeenCalledOnce();
    expect(f.wait).toHaveBeenCalledTimes(3);
    expect(f.read().nodes.find(node => node.id === output.id)?.metadata?.videoTaskId).toBe(taskId);
  });

  it("retains an unconfirmed cancellation or failed status query until a terminal state is observed", async () => {
    const f = fixture(); f.wait.mockRejectedValue(new Error("connection lost"));
    f.status.mockRejectedValueOnce(new Error("status unavailable"));
    f.status.mockImplementation(async task => ({ id: task.id, kind: "video", projectId: "project", nodeId: "source", status: "cancel_requested" }));
    const tasks = createStudioTasks(f.port, () => f.config, f.io);
    await tasks.generate("source", "video", "人物转身");
    const output = f.read().nodes.find(node => node.type === CanvasNodeType.Video)!;
    expect(output.metadata?.videoTaskId).toBeTruthy();
    await tasks.generate("source", "video", "重试");
    expect(f.create).toHaveBeenCalledOnce();
    expect(f.read().nodes.find(node => node.id === output.id)?.metadata?.videoTaskId).toBe(output.metadata?.videoTaskId);
  });

  it("passes first and last frames with their order flag intact to the platform", async () => {
    const f = fixture({ videoMode: "frames", videoFramesReversed: true });
    const references = ["first", "last"].map((id) => ({ id, name: id, type: "image/png", dataUrl: `/api/assets/${id}/content` }));
    f.io.prepare = () => ({ prompt: "首尾过渡", referenceImages: references, referenceVideos: [], referenceAudios: [], imageCount: 2, videoCount: 0, audioCount: 0, textCount: 0 });
    const tasks = createStudioTasks(f.port, () => f.config, f.io);
    await tasks.generate("source", "video", "首尾过渡");
    expect(f.create).toHaveBeenCalledOnce();
    expect(f.create.mock.calls[0][0]).toMatchObject({ videoMode: "frames", videoFramesReversed: true });
    expect(f.create.mock.calls[0][3]).toEqual(references);
  });

  it("leaves unfinished output placeholders idle when their source is deleted", async () => {
    const f = fixture();
    const gate = deferred<PlatformGenerationTask>(); f.create.mockReturnValueOnce(gate.promise);
    const tasks = createStudioTasks(f.port, () => f.config, f.io);
    const work = tasks.generate("source", "image", "创作中删除来源");
    await vi.waitFor(() => expect(f.create).toHaveBeenCalledOnce());
    f.change((document) => ({ ...document, nodes: document.nodes.filter((node) => node.id !== "source") }));
    gate.resolve({ id: "orphan-task", model: "model", scopeId: "scope", projectId: "project" }); await work;
    expect(f.read().nodes).toHaveLength(1);
    expect(f.read().nodes[0].metadata?.status).toBe("idle");
    expect(f.cancel).toHaveBeenCalledWith(expect.objectContaining({ id: "orphan-task" }));
  });

  it("does not simulate unsupported text and audio generation", async () => {
    const f = fixture();
    const tasks = createStudioTasks(f.port, () => f.config, f.io);
    await tasks.generate("source", "text", "写脚本");
    await tasks.generate("source", "audio", "配音");
    expect(f.create).not.toHaveBeenCalled();
    expect(f.notice).toHaveBeenCalledTimes(2);
    expect(f.read().nodes).toHaveLength(1);
  });
});
