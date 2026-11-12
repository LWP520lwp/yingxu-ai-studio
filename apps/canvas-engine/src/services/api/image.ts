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

/** Provider credentials and generation requests are handled by the authenticated host. */
export function requestGeneration(config: AiConfig, prompt: string, options?: RequestOptions) {
    return generatePlatformImages(config, prompt, [], options);
}

export function requestEdit(config: AiConfig, prompt: string, references: ReferenceImage[], options?: RequestOptions) {
    const contextualPrompt = buildImageReferencePromptText(prompt, references);
    return generatePlatformImages(config, contextualPrompt, references, options);
}

export async function requestImageQuestion(
    _config: AiConfig,
    _messages: AiTextMessage[],
    _onDelta: (text: string) => void,
    _options?: RequestOptions,
): Promise<string> {
    return await unsupportedGeneration("text");
}

export async function fetchImageModels(_config: Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat">): Promise<string[]> {
    const { models } = await waitForPlatformInit();
    const ids = [...models.image, ...models.video].map(({ id }) => id);
    return [...new Set(ids)];
}

export function fetchChannelModels(_channel: ModelChannel): Promise<string[]> {
    return fetchImageModels({ baseUrl: "", apiKey: "", apiFormat: "openai" });
}
