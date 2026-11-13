import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installStudioHost } from "@/atlas-engine/studio/studio-host";
import { StudioSession, makeStudioNode } from "@/atlas-engine/studio/studio-document";
import type { PlatformInit } from "./rpc";

const dependencies = vi.hoisted(() => ({
  current: null as PlatformInit | null,
  story: vi.fn(),
}));
vi.mock("./rpc", () => ({ getPlatformInit: () => dependencies.current }));
vi.mock("./story-workflow", () => ({ createStoryWorkflowImport: (...args: unknown[]) => dependencies.story(...args) }));

function fixture() {
  const parentWindow = { postMessage: vi.fn() };
  let receive: ((event: MessageEvent) => void) | undefined;
  const browser = {
    addEventListener: vi.fn((name: string, listener: (event: MessageEvent) => void) => { if (name === "message") receive = listener; }),
    removeEventListener: vi.fn((name: string, listener: (event: MessageEvent) => void) => { if (name === "message" && listener === receive) receive = undefined; }),
  };
  vi.stubGlobal("window", browser); vi.stubGlobal("parent", parentWindow); vi.stubGlobal("location", { origin: "http://localhost:5178" });
  const session = new StudioSession({ nodes: [], connections: [], viewport: { x: 0, y: 0, k: 1 }, backgroundMode: "lines", showImageInfo: false });
  const options = { session, scopeId: "scope", projectId: "project", alive: vi.fn(() => true), center: () => ({ x: 500, y: 400 }), fit: vi.fn(), rename: vi.fn(), command: vi.fn(), notice: vi.fn() };
  const stop = installStudioHost(options);
  const send = (command: string, payload?: unknown, extra: Record<string, unknown> = {}, boundary: Partial<MessageEvent> = {}) => {
    receive?.({ data: { type: "frameflow:command", scopeId: "scope", command, payload, ...extra }, source: parentWindow, origin: "http://localhost:5178", ...boundary } as unknown as MessageEvent);
  };
  return { session, options, stop, send, parentWindow, browser };
}

beforeEach(() => {
  dependencies.story.mockReset();
  dependencies.current = {
    scopeId: "scope", userId: "user", project: { id: "project", title: "草稿" }, baseCanvasDocument: {}, snapshot: null, assets: [],
    models: { image: [{ id: "image-model", name: "图像模型", available: true }], video: [{ id: "video-model", name: "视频模型", available: true }] },
  };
});
afterEach(() => vi.unstubAllGlobals());

describe("studio shell command integration", () => {
  it("accepts only the owning shell, origin, scope and active document", () => {
    const f = fixture();
    f.send("agent", undefined, {}, { origin: "https://foreign.example" });
    f.send("agent", undefined, {}, { source: {} as Window });
    f.send("agent", undefined, { scopeId: "foreign-scope" });
    f.options.alive.mockReturnValue(false); f.send("agent");
    expect(f.options.command).not.toHaveBeenCalled();
    f.options.alive.mockReturnValue(true); f.send("agent");
    expect(f.options.command).toHaveBeenCalledExactlyOnceWith("codex");
    f.stop(); f.send("agent");
    expect(f.options.command).toHaveBeenCalledOnce();
    expect(f.browser.removeEventListener).toHaveBeenCalledOnce();
  });

  it("preserves the shell's existing 200-character draft title limit", () => {
    const f = fixture(); const title = "创".repeat(200);
    f.send("rename", { title });
    expect(f.options.rename).toHaveBeenCalledExactlyOnceWith(title);
  });

  it("routes config and former agent actions to their new destinations", () => {
    const f = fixture(); f.send("openConfig"); f.send("openAgent");
    expect(f.options.command.mock.calls).toEqual([["settings"], ["codex"]]);
  });

  it("inserts generated media results from the web shell without submitting generation", () => {
    const f = fixture();
    f.send("insert", { kind: "video", title: "生成结果", url: "/api/assets/video-id/content", prompt: "人物向前走", assetId: "video-id" });
    expect(f.session.read().nodes).toHaveLength(1);
    expect(f.session.read().nodes[0]).toMatchObject({ type: "video", title: "生成结果", metadata: { content: "/api/assets/video-id/content", prompt: "人物向前走", status: "success" } });
    expect(f.options.notice).not.toHaveBeenCalled();
    expect(dependencies.story).not.toHaveBeenCalled();
  });

  it("keeps image skill dimensions, version and selected reference image", () => {
    const f = fixture(); const reference = makeStudioNode("image", 0, 0, "参考图", { content: "/api/assets/ref/content" });
    f.session.insert([reference]);
    f.send("skill", { kind: "image", title: "横屏镜头", defaults: { skillId: "image-skill", skillVersion: "1.2", prompt: "雨夜汽车", width: 1536, height: 864, model: "image-model" } });
    expect(f.session.read().nodes[1]).toMatchObject({ type: "config", metadata: { generationMode: "image", composerContent: "雨夜汽车", model: "platform::image-model", skillId: "image-skill", skillVersion: "1.2", size: "1536x864" } });
    expect(f.session.read().connections).toMatchObject([{ fromNodeId: reference.id, toNodeId: f.session.read().nodes[1].id }]);
  });

  it("preserves video skill frame requirements and provider-fixed dimensions", () => {
    dependencies.current!.models.video[0].caps = { fixedWidth: 1280, fixedHeight: 720, fixedDuration: 8 };
    const f = fixture();
    f.send("skill", { kind: "video", title: "人物动作", requiresReference: true, defaults: { skillId: "video-skill", skillVersion: "2", prompt: "人物转身", width: 1024, height: 1024, duration: 15 } });
    expect(f.session.read().nodes[0]).toMatchObject({ type: "config", metadata: { generationMode: "video", videoSkillId: "video-skill", videoSkillVersion: "2", videoMode: "reference", size: "1280x720", seconds: "8" } });
  });

  it("chooses a reference-capable image model for an image skill that requires a source", () => {
    dependencies.current!.models.image = [
      { id: "no-reference", available: true, caps: { supportsReferenceImages: false } },
      { id: "with-reference", available: true, caps: { supportsReferenceImages: true } },
    ];
    const f = fixture(); f.session.insert([makeStudioNode("image", 0, 0, "参考图", { content: "/api/assets/ref/content" })]);
    f.send("skill", { kind: "image", requiresReference: true, defaults: { prompt: "保持参考图人物", model: "no-reference" } });
    expect(f.session.read().nodes[1].metadata?.model).toBe("platform::with-reference");
  });

  it("acknowledges repeated storyboard request IDs without adding a second batch", () => {
    dependencies.story.mockReturnValue({ nodes: [makeStudioNode("text", 0, 0, "分镜原文")], connections: [], selectedIds: [], duplicate: false, warnings: [] });
    const f = fixture();
    f.send("storyWorkflow", { segmentId: "segment" }, { id: "request" });
    f.send("storyWorkflow", { segmentId: "segment" }, { id: "request" });
    expect(dependencies.story).toHaveBeenCalledOnce();
    expect(f.session.read().nodes).toHaveLength(1);
    expect(f.parentWindow.postMessage).toHaveBeenCalledTimes(2);
    expect(f.parentWindow.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "frameflow:command-response", scopeId: "scope", id: "request", command: "storyWorkflow", ok: true }), "http://localhost:5178");
  });

  it("reports a rejected storyboard without changing the document", () => {
    dependencies.story.mockImplementation(() => { throw new Error("分镜格式错误"); });
    const f = fixture(); f.send("storyWorkflow", {}, { id: "request" });
    expect(f.session.read().nodes).toHaveLength(0);
    expect(f.parentWindow.postMessage).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: { message: "分镜格式错误" } }), "http://localhost:5178");
  });
});
