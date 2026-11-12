import { describe, expect, it } from "vitest";

import {
  flattenPromptPages,
  getNextPromptPage,
  isPromptTagSelected,
  normalizePromptTags,
  shouldLoadNextPromptPage,
  togglePromptTag,
} from "@/lib/prompt-picker";

const page = (items: string[], total: number) => ({ items, total });

describe("prompt picker state", () => {
  it("normalizes filters and toggles tags without duplicate or all values", () => {
    expect(
      normalizePromptTags(["portrait", "all", "cinema", "portrait"]),
    ).toEqual(["cinema", "portrait"]);
    expect(togglePromptTag(["portrait"], "cinema")).toEqual([
      "cinema",
      "portrait",
    ]);
    expect(togglePromptTag(["portrait", "cinema"], "portrait")).toEqual([
      "cinema",
    ]);
    expect(togglePromptTag(["portrait"], "all")).toEqual([]);
    expect(isPromptTagSelected([], "all")).toBe(true);
    expect(isPromptTagSelected(["portrait"], "portrait")).toBe(true);
  });

  it("advances pages only while the loaded result count is below total", () => {
    expect(getNextPromptPage(page(["a"], 3), [page(["a"], 3)])).toBe(2);
    expect(
      getNextPromptPage(page(["c"], 3), [page(["a"], 3), page(["b"], 3)]),
    ).toBe(3);
    expect(
      getNextPromptPage(page(["b"], 2), [page(["a"], 2), page(["b"], 2)]),
    ).toBeUndefined();
    expect(getNextPromptPage(page([], 0), [])).toBeUndefined();
  });

  it("flattens pages in their server order", () => {
    expect(
      flattenPromptPages([page(["first", "second"], 3), page(["third"], 3)]),
    ).toEqual(["first", "second", "third"]);
    expect(flattenPromptPages(undefined)).toEqual([]);
  });

  it("requests another page only near the end and only when idle", () => {
    expect(
      shouldLoadNextPromptPage(
        { scrollTop: 700, clientHeight: 240, scrollHeight: 1000 },
        true,
        false,
      ),
    ).toBe(true);
    expect(
      shouldLoadNextPromptPage(
        { scrollTop: 300, clientHeight: 240, scrollHeight: 1000 },
        true,
        false,
      ),
    ).toBe(false);
    expect(
      shouldLoadNextPromptPage(
        { scrollTop: 700, clientHeight: 240, scrollHeight: 1000 },
        true,
        true,
      ),
    ).toBe(false);
    expect(
      shouldLoadNextPromptPage(
        { scrollTop: Number.NaN, clientHeight: 240, scrollHeight: 1000 },
        true,
        false,
      ),
    ).toBe(false);
  });
});
