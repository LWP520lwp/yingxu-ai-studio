import { describe, expect, it, vi } from "vitest";

import {
  retryAtlasCanvasNode as retryCanvasNode,
  type AtlasRetryDependencies as CanvasRetryDependencies,
} from "@/atlas-engine/workflows/generation-retry";
import { createAtlasGenerationSession as createCanvasGenerationSession } from "@/atlas-engine/workflows/generation-session";
import { defaultConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const emptyNode = (type: CanvasNodeData["type"]): CanvasNodeData => ({
  id: "node-1",
  type,
  title: "Node",
  position: { x: 0, y: 0 },
  width: 160,
  height: 120,
  metadata: {},
});

function dependencies(overrides: Partial<CanvasRetryDependencies> = {}) {
  return {
    effectiveConfig: defaultConfig,
    nodesRef: { current: [] },
    connectionsRef: { current: [] },
    generationRequests: createCanvasGenerationSession(),
    isAiConfigReady: () => true,
    openConfigDialog: vi.fn(),
    pollVideoNodeTask: vi.fn(async () => undefined),
    startGenerationRequest: vi.fn(() => new AbortController()),
    finishGenerationRequest: vi.fn(() => true),
    setNodesForGeneration: vi.fn(),
    setNodes: vi.fn(),
    setRunningNodeId: vi.fn(),
    completeVideoNodeTask: vi.fn(async () => undefined),
    providers: {},
    notifyError: vi.fn(),
    notifyWarning: vi.fn(),
    translate: (key: string) => key,
    ...overrides,
  } as unknown as CanvasRetryDependencies;
}

describe("retryCanvasNode", () => {
  it("resumes a video task before starting a new provider request", async () => {
    const deps = dependencies();
    const node: CanvasNodeData = {
      ...emptyNode(CanvasNodeType.Video),
      metadata: { videoTaskId: "task-1", status: "error" },
    };

    await retryCanvasNode(node, undefined, deps);

    expect(deps.pollVideoNodeTask).toHaveBeenCalledOnce();
    expect(deps.pollVideoNodeTask).toHaveBeenCalledWith(node);
    expect(deps.startGenerationRequest).not.toHaveBeenCalled();
  });

  it("keeps an empty saved prompt from opening a generation session", async () => {
    const deps = dependencies({
      nodesRef: { current: [emptyNode(CanvasNodeType.Text)] },
    });
    const node = emptyNode(CanvasNodeType.Text);

    await retryCanvasNode(node, undefined, deps);

    expect(deps.notifyWarning).toHaveBeenCalledWith(
      "canvas.projectPage.retryPromptMissing",
    );
    expect(deps.startGenerationRequest).not.toHaveBeenCalled();
  });

  it("reports missing saved edit references without starting a request", async () => {
    let currentNodes = [
      {
        ...emptyNode(CanvasNodeType.Image),
        metadata: {
          generationType: "edit",
          model: "saved-image-model",
          prompt: "Edit the saved image",
          references: [],
          images: [
            {
              id: "retry-me",
              status: "error",
              content: "",
              naturalWidth: 0,
              naturalHeight: 0,
              bytes: 0,
              mimeType: "image/png",
            },
          ],
        },
      },
    ] as CanvasNodeData[];
    const setNodes = vi.fn(
      (update: (nodes: CanvasNodeData[]) => CanvasNodeData[]) => {
        currentNodes = update(currentNodes);
      },
    );
    const deps = dependencies({
      nodesRef: { current: currentNodes },
      setNodes: setNodes as never,
    });

    await retryCanvasNode(currentNodes[0], "retry-me", deps);

    expect(deps.notifyError).toHaveBeenCalledWith(
      "canvas.projectPage.referenceMissing",
    );
    expect(deps.startGenerationRequest).not.toHaveBeenCalled();
    expect(currentNodes[0].metadata?.images?.[0]).toMatchObject({
      status: "error",
      errorDetails: "canvas.projectPage.referenceMissing",
    });
  });

  it("retries one output using its saved model and preserves sibling variants", async () => {
    const session = createCanvasGenerationSession();
    let currentNodes = [
      {
        ...emptyNode(CanvasNodeType.Image),
        metadata: {
          content: "/primary.png",
          generationType: "generation",
          model: "saved-image-model",
          prompt: "A precise product photo",
          images: [
            { id: "primary", status: "success", content: "/primary.png" },
            { id: "retry-me", status: "error", content: "" },
            { id: "sibling", status: "success", content: "/sibling.png" },
          ],
          primaryImageId: "primary",
        },
      },
    ] as CanvasNodeData[];
    const requestGeneration = vi.fn(async (config: { model: string }) => {
      expect(config.model).toBe("saved-image-model");
      return [{ id: "result", dataUrl: "data:image/png;base64,AA==" }];
    });
    const deps = dependencies({
      nodesRef: { current: currentNodes },
      generationRequests: session,
      startGenerationRequest: (target, origin, running, controller) =>
        session.begin(target, origin, running, controller),
      finishGenerationRequest: (target, controller) =>
        session.finish(target, controller),
      setNodesForGeneration: (target, controller, update) => {
        if (session.canWrite(target, controller))
          currentNodes = update(currentNodes);
      },
      providers: {
        requestGeneration,
        uploadImage: vi.fn(async () => ({
          url: "/retried.png",
          storageKey: "retry-key",
          width: 400,
          height: 300,
          bytes: 24,
          mimeType: "image/png",
        })),
      } as never,
    });

    await retryCanvasNode(currentNodes[0], "retry-me", deps);

    expect(requestGeneration).toHaveBeenCalledOnce();
    expect(currentNodes[0].metadata?.images?.map((image) => image.id)).toEqual([
      "primary",
      "retry-me",
      "sibling",
    ]);
    expect(
      currentNodes[0].metadata?.images?.find(
        (image) => image.id === "retry-me",
      ),
    ).toMatchObject({ status: "success", content: "/retried.png" });
    expect(
      currentNodes[0].metadata?.images?.find((image) => image.id === "sibling"),
    ).toMatchObject({ status: "success", content: "/sibling.png" });
  });

  it("does not turn a cancelled provider request into an error", async () => {
    const session = createCanvasGenerationSession();
    let currentNodes = [
      {
        ...emptyNode(CanvasNodeType.Image),
        metadata: {
          generationType: "generation",
          model: "saved-image-model",
          prompt: "retry prompt",
          images: [{ id: "retry-me", status: "error", content: "" }],
        },
      },
    ] as CanvasNodeData[];
    const deps = dependencies({
      nodesRef: { current: currentNodes },
      generationRequests: session,
      startGenerationRequest: (target, origin, running, controller) =>
        session.begin(target, origin, running, controller),
      finishGenerationRequest: (target, controller) =>
        session.finish(target, controller),
      setNodesForGeneration: (target, controller, update) => {
        if (session.canWrite(target, controller))
          currentNodes = update(currentNodes);
      },
      providers: {
        requestGeneration: vi.fn(async () => {
          throw new DOMException("Aborted", "AbortError");
        }),
      } as never,
    });

    await retryCanvasNode(currentNodes[0], "retry-me", deps);

    expect(deps.notifyError).not.toHaveBeenCalled();
    expect(currentNodes[0].metadata?.images?.[0]?.status).toBe("loading");
  });

  it("marks the retry target and reports ordinary provider failures", async () => {
    const session = createCanvasGenerationSession();
    let currentNodes = [
      {
        ...emptyNode(CanvasNodeType.Image),
        metadata: {
          generationType: "generation",
          model: "saved-image-model",
          prompt: "retry prompt",
          images: [{ id: "retry-me", status: "error", content: "" }],
        },
      },
    ] as CanvasNodeData[];
    const deps = dependencies({
      nodesRef: { current: currentNodes },
      generationRequests: session,
      startGenerationRequest: (target, origin, running, controller) =>
        session.begin(target, origin, running, controller),
      finishGenerationRequest: (target, controller) =>
        session.finish(target, controller),
      setNodesForGeneration: (target, controller, update) => {
        if (session.canWrite(target, controller))
          currentNodes = update(currentNodes);
      },
      providers: {
        requestGeneration: vi.fn(async () => {
          throw new Error("provider unavailable");
        }),
      } as never,
    });

    await retryCanvasNode(currentNodes[0], "retry-me", deps);

    expect(deps.notifyError).toHaveBeenCalledWith("provider unavailable");
    expect(currentNodes[0].metadata?.status).toBe("error");
    expect(currentNodes[0].metadata?.images?.[0]).toMatchObject({
      status: "error",
      errorDetails: "provider unavailable",
    });
  });
});
