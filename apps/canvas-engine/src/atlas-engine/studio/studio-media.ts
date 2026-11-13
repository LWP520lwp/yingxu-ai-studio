import i18n from "@/i18n";
import {
  uploadImage,
  resolveImageUrl,
  deleteStoredImages,
  type UploadedImage,
} from "@/services/image-storage";
import {
  uploadMediaFile,
  deleteStoredMedia,
  type UploadedFile,
} from "@/services/file-storage";
import { requestEdit } from "@/services/api/image";
import { readImageMeta } from "@/lib/image-utils";
import {
  cropAtlasImageDataUrl,
  splitAtlasImageDataUrl,
  upscaleAtlasImageDataUrl,
  type AtlasImageAngle,
  type AtlasImageCrop,
  type AtlasImageSplit,
  type AtlasUpscaleOptions,
} from "@/atlas-engine/workflows/image-processing";
import { captureAtlasVideoFrame } from "@/atlas-engine/workflows/video-frame";
import { buildAtlasGenerationConfig } from "@/atlas-engine/workflows/generation-runtime";
import type { AiConfig } from "@/stores/use-config-store";
import type { InsertAssetPayload } from "@/atlas-engine/ui/asset-picker";
import {
  CanvasNodeType,
  type CanvasConnection,
  type CanvasNodeData,
  type Position,
} from "@/types/canvas";
import type { StudioPort } from "./studio-tasks";

type Media = UploadedImage | UploadedFile;
type Saved = { media: Media; image: boolean };
type EditOperation = "crop" | "split" | "upscale" | "angle" | "mask";
type MaskInput = { prompt: string; maskDataUrl: string; generate: boolean };

export type StudioMediaDependencies = {
  image: typeof uploadImage;
  file: typeof uploadMediaFile;
  resolveImage: typeof resolveImageUrl;
  dimensions: typeof readImageMeta;
  removeImages: typeof deleteStoredImages;
  removeFiles: typeof deleteStoredMedia;
  crop: typeof cropAtlasImageDataUrl;
  split: typeof splitAtlasImageDataUrl;
  upscale: typeof upscaleAtlasImageDataUrl;
  capture: typeof captureAtlasVideoFrame;
  edit: typeof requestEdit;
  configuration: typeof buildAtlasGenerationConfig;
  id(): string;
  center?: () => Position;
};

const production: StudioMediaDependencies = {
  image: uploadImage,
  file: uploadMediaFile,
  resolveImage: resolveImageUrl,
  dimensions: readImageMeta,
  removeImages: deleteStoredImages,
  removeFiles: deleteStoredMedia,
  crop: cropAtlasImageDataUrl,
  split: splitAtlasImageDataUrl,
  upscale: upscaleAtlasImageDataUrl,
  capture: captureAtlasVideoFrame,
  edit: requestEdit,
  configuration: buildAtlasGenerationConfig,
  id: () => crypto.randomUUID(),
};

const words = (zh: string, en: string) =>
  i18n.language.startsWith("zh") ? zh : en;
const abort = () => new DOMException("Media transaction expired", "AbortError");

export function createStudioMedia(
  port: StudioPort,
  getConfig: () => AiConfig,
  dependencies: Partial<StudioMediaDependencies> = {},
) {
  const io = { ...production, ...dependencies };
  const controllers = new Set<AbortController>();
  let disposed = false;

  function center(): Position {
    if (io.center) return io.center();
    const { viewport } = port.read();
    return {
      x: (520 - viewport.x) / viewport.k,
      y: (320 - viewport.y) / viewport.k,
    };
  }

  function owns(source?: CanvasNodeData) {
    if (disposed || !port.alive()) return false;
    if (!source) return true;
    const current = port.read().nodes.find((node) => node.id === source.id);
    return (
      current?.type === source.type &&
      current.metadata?.content === source.metadata?.content &&
      current.metadata?.storageKey === source.metadata?.storageKey
    );
  }

  function nodeFor(
    type: CanvasNodeType,
    title: string,
    media: Media,
    point: Position,
  ): CanvasNodeData {
    const naturalWidth =
      media.width || (type === CanvasNodeType.Audio ? 360 : 1280);
    const naturalHeight =
      media.height || (type === CanvasNodeType.Audio ? 100 : 720);
    const scale = Math.min(1, 400 / naturalWidth, 320 / naturalHeight);
    return {
      id: `studio-media-${io.id()}`,
      type,
      title,
      width: Math.round(naturalWidth * scale),
      height: Math.max(100, Math.round(naturalHeight * scale)),
      position: point,
      metadata: {
        content: media.url,
        storageKey: media.storageKey,
        mimeType: media.mimeType,
        bytes: media.bytes,
        naturalWidth,
        naturalHeight,
        durationMs: "durationMs" in media ? media.durationMs : undefined,
        status: "success",
      },
    };
  }

  const edge = (source: string, target: string): CanvasConnection => ({
    id: `studio-media-edge-${io.id()}`,
    fromNodeId: source,
    toNodeId: target,
  });

  async function transaction(
    work: (
      signal: AbortSignal,
      save: (media: Media, image: boolean) => void,
      check: () => void,
    ) => Promise<void>,
    source?: CanvasNodeData,
  ) {
    const controller = new AbortController();
    const ownedFiles: Saved[] = [];
    const existing = new Set(
      port
        .read()
        .nodes.flatMap((node) => [
          node.metadata?.storageKey,
          ...(node.metadata?.images || []).map((image) => image.storageKey),
        ])
        .filter(Boolean),
    );
    controllers.add(controller);
    let committed = false;
    const check = () => {
      if (controller.signal.aborted || !owns(source)) throw abort();
    };
    try {
      check();
      await work(
        controller.signal,
        (media, image) => {
          if (media.storageKey && !existing.has(media.storageKey))
            ownedFiles.push({ media, image });
        },
        check,
      );
      committed = true;
    } catch (error) {
      controller.abort();
      if (owns() && !(error instanceof Error && error.name === "AbortError"))
        port.notice(error instanceof Error ? error.message : String(error));
    } finally {
      controllers.delete(controller);
      if (!committed) {
        // Only this transaction's newly created local objects are eligible for rollback.
        await Promise.allSettled(
          ownedFiles.map(({ media, image }) =>
            image
              ? io.removeImages([media.storageKey!])
              : io.removeFiles([media.storageKey!]),
          ),
        );
      }
    }
    return committed;
  }

  async function importFiles(input: FileList | File[], replaceId?: string) {
    const files = Array.from(input);
    if (!files.length) return;
    const replace = replaceId
      ? port.read().nodes.find((node) => node.id === replaceId)
      : undefined;
    if (replaceId && !replace) return;
    if (replace && files.length !== 1) {
      port.notice(
        words(
          "替换素材时请只选择一个文件。",
          "Choose one file when replacing media.",
        ),
      );
      return;
    }
    await transaction(async (signal, save, check) => {
      const point = center();
      const results: CanvasNodeData[] = new Array(files.length);
      let cursor = 0;
      const worker = async () => {
        while (cursor < files.length) {
          check();
          const index = cursor++;
          const file = files[index];
          const type = file.type.startsWith("image/")
            ? CanvasNodeType.Image
            : file.type.startsWith("video/")
              ? CanvasNodeType.Video
              : file.type.startsWith("audio/")
                ? CanvasNodeType.Audio
                : null;
          if (!type)
            throw new Error(
              words(
                `不支持的素材：${file.name}`,
                `Unsupported media: ${file.name}`,
              ),
            );
          if (replace && replace.type !== type)
            throw new Error(
              words(
                "替换文件的媒体类型必须与节点一致。",
                "The replacement file must match the node's media type.",
              ),
            );
          const media =
            type === CanvasNodeType.Image
              ? await io.image(file, { signal })
              : await io.file(file, type, { signal });
          save(media, type === CanvasNodeType.Image);
          check();
          results[index] = nodeFor(type, file.name, media, {
            x: point.x + (index % 3) * 440,
            y: point.y + Math.floor(index / 3) * 360,
          });
        }
      };
      // Wait for all workers to settle before rollback, including late successful uploads.
      const completed = await Promise.allSettled(
        Array.from({ length: Math.min(3, files.length) }, worker),
      );
      const failure = completed.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (failure) throw failure.reason;
      check();
      if (replace) {
        const result = results[0];
        port.change((document) => ({
          ...document,
          nodes: document.nodes.map((node) =>
            node.id === replace.id
              ? {
                  ...node,
                  width: result.width,
                  height: result.height,
                  metadata: {
                    ...node.metadata,
                    ...result.metadata,
                    images: undefined,
                    primaryImageId: undefined,
                  },
                }
              : node,
          ),
        }));
      } else port.insert(results);
    }, replace);
  }

  async function insertAsset(payload: InsertAssetPayload) {
    return transaction(async (signal, save, check) => {
      const point = center();
      if (payload.kind === "text") {
        port.insert([
          {
            id: `studio-text-${io.id()}`,
            type: CanvasNodeType.Text,
            title: payload.title,
            position: point,
            width: 360,
            height: 240,
            metadata: { content: payload.content, status: "success" },
          },
        ]);
        return;
      }
      if (payload.kind === "video" || payload.kind === "audio") {
        port.insert([
          nodeFor(
            payload.kind === "audio"
              ? CanvasNodeType.Audio
              : CanvasNodeType.Video,
            payload.title,
            {
              url: payload.url,
              storageKey: payload.storageKey || "",
              mimeType:
                payload.mimeType ||
                (payload.kind === "audio" ? "audio/mpeg" : "video/mp4"),
              bytes: 0,
              width: payload.kind === "video" ? payload.width : undefined,
              height: payload.kind === "video" ? payload.height : undefined,
            },
            point,
          ),
        ]);
        return;
      }
      const url = await io.resolveImage(payload.storageKey, payload.dataUrl);
      check();
      if (!url)
        throw new Error(
          words(
            "这个素材暂时无法读取。",
            "This asset is not currently readable.",
          ),
        );
      let media: UploadedImage;
      if (payload.storageKey || /^\/api\/assets\/[^/]+\/content$/.test(url)) {
        const dimensions = await io.dimensions(url);
        media = {
          url,
          storageKey: payload.storageKey,
          bytes: 0,
          mimeType: dimensions.mimeType,
          width: dimensions.width,
          height: dimensions.height,
        };
      } else {
        media = await io.image(url, { signal });
        save(media, true);
      }
      check();
      port.insert([nodeFor(CanvasNodeType.Image, payload.title, media, point)]);
    });
  }

  async function capture(source: CanvasNodeData, position: "start" | "end") {
    if (source.type !== CanvasNodeType.Video || !source.metadata?.content)
      return;
    await transaction(async (signal, save, check) => {
      const frame = await io.capture(
        source.metadata!.content!,
        position === "start" ? "first" : "last",
        0,
      );
      check();
      const image = await io.image(frame, { signal });
      save(image, true);
      check();
      const node = nodeFor(
        CanvasNodeType.Image,
        `${source.title} · ${position === "start" ? words("首帧", "First frame") : words("尾帧", "Last frame")}`,
        image,
        { x: source.position.x + source.width + 120, y: source.position.y },
      );
      port.insert([node], [edge(source.id, node.id)]);
    }, source);
  }

  async function edit(
    source: CanvasNodeData,
    operation: EditOperation,
    parameters: unknown,
  ) {
    if (source.type !== CanvasNodeType.Image || !source.metadata?.content)
      return;
    await transaction(async (signal, save, check) => {
      const url = await io.resolveImage(
        source.metadata?.storageKey,
        source.metadata!.content!,
      );
      check();
      if (!url)
        throw new Error(
          words(
            "原图不可用，请重新上传。",
            "The source image is unavailable. Upload it again.",
          ),
        );
      const generated: CanvasNodeData[] = [];
      const links: CanvasConnection[] = [];
      const storeResult = async (
        input: string | Blob,
        suffix: string,
        index = 0,
      ) => {
        const stored = await io.image(input, { signal });
        save(stored, true);
        check();
        const node = nodeFor(
          CanvasNodeType.Image,
          `${source.title} · ${suffix}`,
          stored,
          {
            x: source.position.x + source.width + 120 + (index % 3) * 440,
            y: source.position.y + Math.floor(index / 3) * 360,
          },
        );
        generated.push(node);
        links.push(edge(source.id, node.id));
        return node;
      };
      if (operation === "crop") {
        await storeResult(
          await io.crop(url, parameters as AtlasImageCrop),
          words("裁切", "Crop"),
        );
      } else if (operation === "split") {
        const split = parameters as AtlasImageSplit;
        if (
          !split ||
          !Number.isInteger(split.rows) ||
          !Number.isInteger(split.columns) ||
          split.rows < 1 ||
          split.columns < 1 ||
          split.rows * split.columns > 64
        )
          throw new Error(
            words(
              "分图网格最多支持 64 块。",
              "A split grid supports at most 64 pieces.",
            ),
          );
        const pieces = await io.split(url, split);
        check();
        for (let index = 0; index < pieces.length; index++) {
          const piece = pieces[index];
          await storeResult(
            piece.dataUrl,
            `${piece.row + 1}-${piece.column + 1}`,
            index,
          );
        }
      } else if (operation === "upscale") {
        await storeResult(
          await io.upscale(url, parameters as AtlasUpscaleOptions),
          words("放大", "Upscale"),
        );
      } else {
        const references = [
          {
            id: source.id,
            name: source.title,
            dataUrl: url,
            type: source.metadata?.mimeType || "image/png",
            storageKey: source.metadata?.storageKey,
          },
        ];
        let prompt: string;
        if (operation === "angle") {
          const angle = parameters as AtlasImageAngle;
          if (
            !angle ||
            ![
              angle.horizontalAngle,
              angle.pitchAngle,
              angle.cameraDistance,
            ].every(Number.isFinite)
          )
            throw new Error(
              words(
                "请检查相机角度与距离。",
                "Check the camera angles and distance.",
              ),
            );
          prompt = `根据参考图重建同一主体的新相机视角。保持人物、物体身份、材质、环境和光照一致。相机水平角 ${angle.horizontalAngle} 度，俯仰角 ${angle.pitchAngle} 度，镜头距离 ${angle.cameraDistance}，${angle.wideAngle ? "广角镜头" : "自然透视镜头"}。重新生成遮挡后的空间细节，避免拉伸或仅扭曲原图。`;
        } else {
          const mask = parameters as MaskInput;
          if (
            !mask ||
            typeof mask.prompt !== "string" ||
            !mask.prompt.trim() ||
            typeof mask.maskDataUrl !== "string" ||
            !mask.maskDataUrl.startsWith("data:image/")
          )
            throw new Error(
              words(
                "请先涂抹修改区域并填写编辑要求。",
                "Paint an edit region and describe the change.",
              ),
            );
          const stored = await io.image(mask.maskDataUrl, { signal });
          save(stored, true);
          check();
          const maskNode = nodeFor(
            CanvasNodeType.Image,
            words("局部编辑蒙版", "Edit region mask"),
            stored,
            {
              x: source.position.x,
              y: source.position.y + source.height + 100,
            },
          );
          generated.push(maskNode);
          references.push({
            id: maskNode.id,
            name: "mask.png",
            dataUrl: stored.url,
            type: stored.mimeType,
            storageKey: stored.storageKey,
          });
          prompt = `图1为原图，图2为编辑区域蒙版。仅在蒙版标记的区域执行下列修改，保留其余区域与主体身份：${mask.prompt.trim()}`;
          if (!mask.generate) {
            const target: CanvasNodeData = {
              id: `studio-config-${io.id()}`,
              type: CanvasNodeType.Config,
              title: words("局部编辑方案", "Local edit recipe"),
              position: {
                x: source.position.x + source.width + 120,
                y: source.position.y,
              },
              width: 360,
              height: 240,
              metadata: {
                generationMode: "image",
                prompt,
                composerContent: `${prompt}\n@[node:${source.id}]\n@[node:${maskNode.id}]`,
                status: "idle",
              },
            };
            generated.push(target);
            links.push(
              edge(source.id, target.id),
              edge(maskNode.id, target.id),
            );
            check();
            port.insert(generated, links);
            return;
          }
        }
        const config = {
          ...io.configuration(getConfig(), source, "image"),
          count: "1",
        };
        const results = await io.edit(config, prompt, references, { signal });
        check();
        if (!results[0]?.dataUrl)
          throw new Error(
            words(
              "图像通道未返回编辑结果。",
              "The image channel returned no edited image.",
            ),
          );
        const edited = await storeResult(
          results[0].dataUrl,
          operation === "angle"
            ? words("AI 新视角", "AI camera view")
            : words("局部修改", "Local edit"),
        );
        edited.metadata = { ...edited.metadata, prompt };
        if (operation === "mask" && generated[0])
          links.push(edge(generated[0].id, edited.id));
      }
      check();
      port.insert(generated, links);
    }, source);
  }

  return {
    importFiles,
    insertAsset,
    capture,
    edit,
    dispose() {
      disposed = true;
      for (const controller of controllers) controller.abort();
      controllers.clear();
    },
  };
}
