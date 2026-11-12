import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { requestEdit, requestGeneration } from "@/services/api/image";
import type { uploadImage } from "@/services/image-storage";
import { throwIfAborted } from "@/services/media-storage-runtime";
import { runCanvasGenerationBatch } from "@/lib/canvas/canvas-generation-batch";

export type CanvasImageBatchPorts = {
  generate: typeof requestGeneration;
  edit: typeof requestEdit;
  upload: typeof uploadImage;
  isCancelled: (error: unknown) => boolean;
};

export type CanvasImageBatchArgs = {
  imageIds: readonly string[];
  config: AiConfig;
  prompt: string;
  references: ReferenceImage[];
  signal: AbortSignal;
  ports: CanvasImageBatchPorts;
  onImage: (
    imageId: string,
    image: Awaited<ReturnType<typeof uploadImage>>,
  ) => void;
  onFailure?: (imageId: string, error: unknown) => void;
};

export function generateCanvasImageBatch({
  imageIds,
  config,
  prompt,
  references,
  signal,
  ports,
  onImage,
  onFailure,
}: CanvasImageBatchArgs) {
  return runCanvasGenerationBatch(
    imageIds,
    async (imageId) => {
      throwIfAborted(signal);
      const image = references.length
        ? await ports
            .edit({ ...config, count: "1" }, prompt, references, { signal })
            .then((items) => items[0])
        : await ports
            .generate({ ...config, count: "1" }, prompt, { signal })
            .then((items) => items[0]);
      throwIfAborted(signal);
      if (!image?.dataUrl) throw new Error("Image provider returned no image");
      const uploaded = await ports.upload(image.dataUrl, { signal });
      throwIfAborted(signal);
      onImage(imageId, uploaded);
    },
    { isCancelled: ports.isCancelled, onFailure },
  );
}
