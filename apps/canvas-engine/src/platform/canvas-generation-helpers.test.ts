import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  activeImageResolutions: 0,
  maxImageResolutions: 0,
  resolveImageUrl: vi.fn(),
  resolveMediaUrl: vi.fn(),
  ensureImagePreview: vi.fn(),
  uploadImage: vi.fn(),
}));

vi.mock("@/services/image-storage", () => ({
  ensureImagePreview: storage.ensureImagePreview,
  resolveImageUrl: storage.resolveImageUrl,
  uploadImage: storage.uploadImage,
}));
vi.mock("@/services/file-storage", () => ({
  resolveMediaUrl: storage.resolveMediaUrl,
}));
vi.mock("@/atlas-engine/model/node-factory", () => ({
  atlasImageMetadata: (image: {
    url: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
  }) => ({
    content: image.url,
    storageKey: image.storageKey,
    naturalWidth: image.width,
    naturalHeight: image.height,
    bytes: image.bytes,
    mimeType: image.mimeType,
    status: "success",
  }),
  atlasReferenceUrl: (image: {
    storageKey?: string;
    url?: string;
    dataUrl: string;
  }) =>
    image.storageKey ||
    image.url ||
    (!image.dataUrl.startsWith("data:") ? image.dataUrl : undefined),
}));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@/stores/use-config-store", () => ({
  defaultConfig: {},
  resolveModelForCapability: vi.fn(),
}));

import {
  CanvasNodeType,
  type CanvasConnection,
  type CanvasNodeData,
} from "@/types/canvas";
import {
  atlasAudioExtension as audioExtension,
  buildAtlasGenerationConfig as buildGenerationConfig,
  findAtlasRetrySourceNode as findRetrySourceNode,
  atlasGenerationReferenceUrls as generationReferenceUrls,
  atlasGenerationCount as getGenerationCount,
  hydrateAtlasAssistantImages as hydrateAssistantImages,
  hydrateAtlasCanvasImages as hydrateCanvasImages,
  atlasImageExtension as imageExtension,
  isAtlasAudioFile as isAudioFile,
} from "@/atlas-engine/workflows/generation-runtime";
import {
  resolveModelForCapability,
  type AiConfig,
} from "@/stores/use-config-store";

const node = (
  id: string,
  type: CanvasNodeData["type"],
  metadata?: CanvasNodeData["metadata"],
): CanvasNodeData => ({
  id,
  type,
  title: id,
  position: { x: 0, y: 0 },
  width: 120,
  height: 80,
  metadata,
});
const edge = (fromNodeId: string, toNodeId: string): CanvasConnection => ({
  id: `${fromNodeId}-${toNodeId}`,
  fromNodeId,
  toNodeId,
});

beforeEach(() => {
  storage.activeImageResolutions = 0;
  storage.maxImageResolutions = 0;
  storage.resolveImageUrl
    .mockReset()
    .mockImplementation(async (key: string, fallback: string) => {
      storage.activeImageResolutions += 1;
      storage.maxImageResolutions = Math.max(
        storage.maxImageResolutions,
        storage.activeImageResolutions,
      );
      await new Promise((resolve) => setTimeout(resolve, 2));
      storage.activeImageResolutions -= 1;
      return key ? `resolved:${key}` : fallback;
    });
  storage.resolveMediaUrl
    .mockReset()
    .mockImplementation(async (key: string) => `resolved:${key}`);
  storage.ensureImagePreview.mockReset().mockResolvedValue(undefined);
  storage.uploadImage
    .mockReset()
    .mockImplementation(async () => ({
      url: "/api/assets/new/content",
      storageKey: "asset:new",
      width: 640,
      height: 480,
      bytes: 1234,
      mimeType: "image/png",
    }));
});

describe("canvas generation support", () => {
  it("normalizes image and audio extensions and recognizes audio filenames without MIME types", () => {
    expect(imageExtension("data:image/webp;base64,abc")).toBe("webp");
    expect(audioExtension("audio/mp4")).toBe("m4a");
    expect(audioExtension("audio/ogg; codecs=opus")).toBe("opus");
    expect(isAudioFile({ type: "", name: "voice.FLAC" } as File)).toBe(true);
    expect(isAudioFile({ type: "text/plain", name: "notes.txt" } as File)).toBe(
      false,
    );
  });

  it("clamps generation counts and preserves explicit false video settings", () => {
    expect([
      getGenerationCount("0"),
      getGenerationCount("-3"),
      getGenerationCount("99"),
      getGenerationCount("bad"),
    ]).toEqual([1, 1, 15, 1]);
    vi.mocked(resolveModelForCapability).mockReturnValue("video-model");
    const config = {
      model: "default-model",
      videoGenerateAudio: "true",
      videoWatermark: "true",
      count: "2",
    } as unknown as AiConfig;
    const videoNode = node("video", CanvasNodeType.Video, {
      generateAudio: "false",
      watermark: "false",
    });

    expect(buildGenerationConfig(config, videoNode, "video")).toMatchObject({
      model: "video-model",
      videoGenerateAudio: "false",
      videoWatermark: "false",
    });
  });

  it("deduplicates stored generation references while preserving input order", () => {
    const urls = generationReferenceUrls({
      referenceImages: [
        {
          id: "1",
          name: "one.png",
          type: "image/png",
          dataUrl: "data:image/png;base64,abc",
          storageKey: "image:one",
        },
        {
          id: "2",
          name: "two.png",
          type: "image/png",
          dataUrl: "/image/two",
          storageKey: "image:two",
        },
      ],
      referenceVideos: [{ storageKey: "video:one" }, { url: "video:one" }],
      referenceAudios: [{ url: "audio:one" }, {}],
    });
    expect(urls).toEqual(["image:one", "image:two", "video:one", "audio:one"]);
  });

  it("hydrates large image sets with bounded concurrency and restores media URLs", async () => {
    const nodes = [
      ...Array.from({ length: 11 }, (_, index) =>
        node(`image-${index}`, CanvasNodeType.Image, {
          storageKey: `image:${index}`,
          content: `/image/${index}`,
          images: Array.from({ length: 6 }, (_, childIndex) => ({
            id: `image-${index}-${childIndex}`,
            status: "success" as const,
            content: `/child/${index}/${childIndex}`,
            storageKey: `child:${index}:${childIndex}`,
            naturalWidth: 20,
            naturalHeight: 30,
            bytes: 10,
            mimeType: "image/png",
          })),
        }),
      ),
      node("video", CanvasNodeType.Video, {
        storageKey: "video:one",
        content: "/video/one",
      }),
    ];
    const restored = await hydrateCanvasImages(nodes);
    expect(storage.maxImageResolutions).toBe(4);
    expect(restored[3].metadata?.content).toBe("resolved:image:3");
    expect(restored[11].metadata?.content).toBe("resolved:video:one");
    expect(storage.resolveMediaUrl).toHaveBeenCalledWith(
      "video:one",
      "/video/one",
    );
  });

  it("keeps nested image records when migrating an inline image to stored media", async () => {
    const source = node("image", CanvasNodeType.Image, {
      content: "data:image/png;base64,abc",
      images: [
        {
          id: "child",
          status: "success",
          content: "/child",
          storageKey: "image:child",
          naturalWidth: 20,
          naturalHeight: 30,
          bytes: 10,
          mimeType: "image/png",
        },
      ],
    });
    const [restored] = await hydrateCanvasImages([source]);
    expect(restored.metadata).toMatchObject({
      content: "/api/assets/new/content",
      storageKey: "asset:new",
      status: "success",
    });
    expect(restored.metadata?.images?.[0]).toMatchObject({
      id: "child",
      content: "resolved:image:child",
    });
  });

  it("finds the nearest upstream config once even when the graph contains a cycle", () => {
    const config = node("config", CanvasNodeType.Config);
    const nodes = [
      config,
      node("text", CanvasNodeType.Text),
      node("target", CanvasNodeType.Image),
    ];
    const connections = [
      edge("text", "target"),
      edge("config", "text"),
      edge("target", "text"),
    ];
    expect(findRetrySourceNode("target", nodes, connections)).toBe(config);
    expect(findRetrySourceNode("missing", nodes, connections)).toBeNull();
  });

  it("hydrates assistant references and leaves non-image values intact", async () => {
    const sessions = [
      {
        id: "session",
        title: "session",
        createdAt: "now",
        updatedAt: "now",
        messages: [
          {
            id: "message",
            role: "assistant" as const,
            text: "result",
            references: [
              {
                id: "stored",
                type: CanvasNodeType.Image,
                title: "stored",
                storageKey: "image:stored",
                dataUrl: "/old",
              },
              {
                id: "inline",
                type: CanvasNodeType.Image,
                title: "inline",
                dataUrl: "data:image/png;base64,abc",
              },
              {
                id: "text",
                type: CanvasNodeType.Text,
                title: "text",
                text: "keep",
              },
            ],
          },
        ],
      },
    ];
    const [restored] = await hydrateAssistantImages(sessions);
    expect(restored.messages[0].references).toMatchObject([
      { id: "stored", dataUrl: "resolved:image:stored" },
      {
        id: "inline",
        dataUrl: "/api/assets/new/content",
        storageKey: "asset:new",
      },
      { id: "text", text: "keep" },
    ]);
  });
});
