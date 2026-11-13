import type { UploadedFile } from "@/services/file-storage";
import type { UploadedImage } from "@/services/image-storage";
import type { CanvasNodeMetadata, CanvasNodeText } from "@/types/canvas";

export type AtlasGenerationEvent =
  | Readonly<{ type: "image-stored"; variantId: string; image: UploadedImage }>
  | Readonly<{ type: "image-failed"; variantId: string; details: string }>
  | Readonly<{ type: "text-patch"; variantId: string; patch: Partial<CanvasNodeText> }>
  | Readonly<{
      type: "audio-stored";
      audio: UploadedFile;
      metadata: CanvasNodeMetadata;
    }>;
