import type { AiConfig, ModelChannel } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import { buildImageReferencePromptText } from "@/lib/image-reference-prompt";
import { generatePlatformImages, unsupportedGeneration } from "@/platform/generation";
import { waitForPlatformInit } from "@/platform/rpc";

export type AiTextMessage = {
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};
type RequestOptions = { signal?: AbortSignal };

/** Generation is authenticated by the host workbench session; no provider key enters this frame. */
export function requestGeneration(config: AiConfig, prompt: string, options?: RequestOptions) {
    return generatePlatformImages(config, prompt, [], options);
}

export function requestEdit(config: AiConfig, prompt: string, references: ReferenceImage[], options?: RequestOptions) {
    return generatePlatformImages(config, buildImageReferencePromptText(prompt, references), references, options);
}

export async function requestImageQuestion(_config: AiConfig, _messages: AiTextMessage[], _onDelta: (text: string) => void, _options?: RequestOptions): Promise<string> {
    return unsupportedGeneration("text");
}

export async function fetchImageModels(_config: Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat">) {
    const init = await waitForPlatformInit();
    return [...new Set([...init.models.image, ...init.models.video].map((model) => model.id))];
}

export function fetchChannelModels(_channel: ModelChannel) {
    return fetchImageModels({ baseUrl: "", apiKey: "", apiFormat: "openai" });
}
