import { describe, expect, it } from "vitest";
import { applyDraftRename, draftTitleError, mergeDraftPage, type DraftSummary } from "./draftLibraryModel";

const draft = (id: string, second: number): DraftSummary => ({ projectId: id, kind: "canvas", title: id, revision: second, updatedAt: `2026-11-10T12:00:${String(second).padStart(2, "0")}Z`, itemCount: 0 });

describe("draft library pages", () => {
  it("refresh replaces a previous search instead of leaking its results", () => {
    expect(mergeDraftPage([draft("old", 1)], { items: [draft("match", 2)], nextCursor: null }, false).map((item) => item.projectId)).toEqual(["match"]);
  });

  it("append deduplicates pages without replacing a newer in-memory save", () => {
    const items = mergeDraftPage([draft("b", 4), draft("a", 4)], { items: [draft("b", 2), draft("c", 1)], nextCursor: null }, true);
    expect(items.map((item) => item.projectId)).toEqual(["b", "a", "c"]);
    expect(items[0].revision).toBe(4);
  });

  it("applies a rename only to its own kind and removes an item that no longer matches search", () => {
    const canvas = { ...draft("shared", 1), title: "月球画布" };
    const science: DraftSummary = { ...canvas, kind: "science", title: "独立科普" };
    const renamed = { ...canvas, revision: 2, title: "星球探索", updatedAt: draft("unused", 5).updatedAt };
    expect(applyDraftRename([science, canvas], renamed).map((item) => item.title)).toEqual(["星球探索", "独立科普"]);
    expect(applyDraftRename([canvas], renamed, "月球")).toEqual([]);
    expect(applyDraftRename([canvas], renamed, " 星球 ")[0].title).toBe("星球探索");
  });

  it("cannot regress a newer revision or add another account's unknown draft", () => {
    const known = draft("known", 4);
    expect(applyDraftRename([known], { ...known, revision: 2, title: "stale" })).toEqual([known]);
    expect(applyDraftRename([known], draft("unknown", 9))).toEqual([known]);
  });

  it("validates useful names without rejecting Chinese, quotes or punctuation", () => {
    for (const name of ["", "   ", "x".repeat(201), "第一行\n第二行", "控制\u0085字符"]) expect(draftTitleError(name)).not.toBe("");
    for (const name of [" 月球为什么总是这一面 ", '名称 "01" / 第一次', "x".repeat(200)]) expect(draftTitleError(name)).toBe("");
  });
});
