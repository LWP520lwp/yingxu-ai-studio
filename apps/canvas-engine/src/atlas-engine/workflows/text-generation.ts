import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasNodeText } from "@/types/canvas";
import type { requestImageQuestion } from "@/services/api/image";
import { throwIfAborted } from "@/services/media-storage-runtime";

export type AtlasTextBatchPorts = {
  request: typeof requestImageQuestion;
  isCancelled: (error: unknown) => boolean;
};

export type AtlasTextBatchArgs = {
  textIds: readonly string[];
  config: AiConfig;
  messages: Parameters<typeof requestImageQuestion>[1];
  signal: AbortSignal;
  ports: AtlasTextBatchPorts;
  onStream: (textId: string, text: string) => void;
  onSuccess: (textId: string, content: string) => void;
  onFailure: (textId: string, error: unknown) => string;
};

export async function generateAtlasTextBatch({
  textIds,
  config,
  messages,
  signal,
  ports,
  onStream,
  onSuccess,
  onFailure,
}: AtlasTextBatchArgs): Promise<Array<CanvasNodeText | null>> {
  return Promise.all(
    textIds.map(async (textId): Promise<CanvasNodeText | null> => {
      let streamed = "";
      try {
        throwIfAborted(signal);
        const answer = await ports.request(
          config,
          messages,
          (text) => {
            if (signal.aborted) return;
            streamed = text;
            onStream(textId, text);
          },
          { signal },
        );
        throwIfAborted(signal);
        const content = answer || streamed;
        onSuccess(textId, content);
        return { id: textId, status: "success", content };
      } catch (error) {
        if (ports.isCancelled(error)) return null;
        const errorDetails = onFailure(textId, error);
        return {
          id: textId,
          status: "error",
          content: "",
          errorDetails,
        };
      }
    }),
  );
}
