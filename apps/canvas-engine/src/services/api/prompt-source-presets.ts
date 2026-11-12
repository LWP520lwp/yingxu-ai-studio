import { nanoid } from "nanoid";

export type PromptSource = {
  id: string;
  name: string;
  url: string;
  homepage: string;
  enabled: boolean;
  builtIn: boolean;
};

export const PROMPT_REGISTRY_HOMEPAGE =
  "https://github.com/yukkcat/image-prompts";

const catalogRoot =
  "https://raw.githubusercontent.com/yukkcat/image-prompts/main/dist/sources/";

const catalog: readonly [id: string, name: string, homepage: string][] = [
  [
    "banana-prompt-quicker",
    "Banana Prompt Quicker",
    "https://glidea.github.io/banana-prompt-quicker/",
  ],
  [
    "davidwu-gpt-image2-prompts",
    "DavidWu GPT Image 2",
    "https://github.com/davidwuw0811-boop/awesome-gpt-image2-prompts",
  ],
  [
    "freestylefly-gpt-image-2",
    "Freestylefly GPT Image 2",
    "https://github.com/freestylefly/awesome-gpt-image-2",
  ],
  [
    "awesome-gpt-image",
    "Awesome GPT Image",
    "https://github.com/ZeroLu/awesome-gpt-image",
  ],
  [
    "awesome-gpt4o-image-prompts",
    "Awesome GPT-4o",
    "https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts",
  ],
  [
    "youmind-gpt-image-2",
    "YouMind GPT Image 2",
    "https://github.com/YouMind-OpenLab/awesome-gpt-image-2",
  ],
  [
    "youmind-nano-banana-pro",
    "YouMind Nano Banana Pro",
    "https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts",
  ],
];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Build an editable record while keeping explicit disabled/custom settings. */
export function createPromptSource(
  input: Partial<PromptSource> = {},
): PromptSource {
  return {
    id: text(input.id) || nanoid(),
    name: text(input.name),
    url: text(input.url),
    homepage: text(input.homepage),
    enabled: input.enabled ?? true,
    builtIn: input.builtIn ?? false,
  };
}

export const DEFAULT_PROMPT_SOURCES: PromptSource[] = catalog.map(
  ([id, name, homepage]) =>
    createPromptSource({
      id,
      name,
      homepage,
      url: new URL(`${id}.json`, catalogRoot).href,
      builtIn: true,
    }),
);
