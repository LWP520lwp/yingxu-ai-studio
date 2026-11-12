import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPromptSource,
  DEFAULT_PROMPT_SOURCES,
} from "@/services/api/prompt-source-presets";
import {
  decodePromptSource,
  runPromptSource,
} from "@/services/api/prompt-source-runtime";
import {
  isHttpUrl,
  validatePromptSourceDraft,
} from "@/components/layout/prompt-source-editor-drawer";

describe("prompt source formats and requests", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps stable catalog endpoints and explicit false settings", () => {
    const source = createPromptSource({ id: " custom ", enabled: false });

    expect(source).toMatchObject({
      id: "custom",
      name: "",
      url: "",
      homepage: "",
      enabled: false,
      builtIn: false,
    });
    expect(new Set(DEFAULT_PROMPT_SOURCES.map(({ id }) => id)).size).toBe(
      DEFAULT_PROMPT_SOURCES.length,
    );
    expect(DEFAULT_PROMPT_SOURCES.every((item) => item.builtIn)).toBe(true);
    expect(
      DEFAULT_PROMPT_SOURCES.every((item) =>
        item.url.endsWith(`${item.id}.json`),
      ),
    ).toBe(true);
  });

  it("normalizes source-relative media, ignores invalid rows and keeps the first duplicate id", () => {
    const source = createPromptSource({
      id: "source",
      name: "Source",
      url: "https://example.com/catalog/prompts.json",
    });
    const decoded = decodePromptSource(
      [
        {
          id: "same",
          title: " First ",
          prompt: " prompt ",
          referenceImageUrls: ["../cover.jpg"],
          tags: [" tag ", null],
        },
        { id: "same", title: "Duplicate", prompt: "discard me" },
        { title: "Fallback", prompt: "entry", imageCount: "2" },
        { title: "Missing body" },
        null,
      ],
      source,
    );

    expect(decoded).toHaveLength(2);
    expect(decoded[0]).toMatchObject({
      id: "same",
      title: "First",
      prompt: "prompt",
      coverUrl: "https://example.com/cover.jpg",
      referenceImageUrls: ["https://example.com/cover.jpg"],
      tags: ["tag"],
    });
    expect(decoded[1]).toMatchObject({
      id: "source-0003",
      title: "Fallback",
      imageCount: 2,
    });
  });

  it("rejects a malformed root and rejects empty built-in catalogs", async () => {
    const source = createPromptSource({
      id: "source",
      url: "https://example.com/prompts.json",
    });
    expect(() => decodePromptSource({ prompts: [] }, source)).toThrow();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { status: 200 })),
    );
    await expect(
      runPromptSource({ ...source, builtIn: true }),
    ).rejects.toThrow();
  });

  it("preserves AbortError and explicit abort reasons without wrapping them", async () => {
    const source = createPromptSource({
      id: "source",
      url: "https://example.com/prompts.json",
    });
    const fetchFailure = new DOMException("stopped", "AbortError");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw fetchFailure;
      }),
    );
    await expect(runPromptSource(source)).rejects.toBe(fetchFailure);

    const reason = new Error("cancelled by caller");
    const controller = new AbortController();
    controller.abort(reason);
    await expect(
      runPromptSource(source, { signal: controller.signal }),
    ).rejects.toBe(reason);
  });

  it("validates only HTTP(S) URLs and trims persisted fields", () => {
    expect(isHttpUrl("https://example.com/prompts.json")).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(
      validatePromptSourceDraft(
        createPromptSource({
          name: "  My source ",
          url: " https://example.com/a.json ",
        }),
      ),
    ).toEqual({
      valid: true,
      value: {
        id: expect.any(String),
        name: "My source",
        url: "https://example.com/a.json",
        homepage: "",
        enabled: true,
        builtIn: false,
      },
    });
  });
});
