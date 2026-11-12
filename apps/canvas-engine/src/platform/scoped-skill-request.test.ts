import { describe, expect, it } from "vitest";

import {
  isCurrentSkillRequest,
  skillRequestErrorMessage,
} from "./scoped-skill-request";

describe("scoped Skill request guards", () => {
  it("accepts a live result from the active scope and revision", () => {
    expect(
      isCurrentSkillRequest(
        { scopeId: "project-a", revision: 4, key: "recipe-a" },
        { scopeId: "project-a", revision: 4, key: "recipe-a" },
      ),
    ).toBe(true);
  });

  it.each([
    ["a changed scope", { scopeId: "project-b", revision: 4, key: "recipe-a" }],
    ["a newer request", { scopeId: "project-a", revision: 5, key: "recipe-a" }],
    [
      "a changed migration key",
      { scopeId: "project-a", revision: 4, key: "recipe-b" },
    ],
    ["a missing active scope", { scopeId: null, revision: 4, key: "recipe-a" }],
  ] as const)("rejects stale results after %s", (_reason, snapshot) => {
    expect(
      isCurrentSkillRequest(
        { scopeId: "project-a", revision: 4, key: "recipe-a" },
        snapshot,
      ),
    ).toBe(false);
  });

  it("rejects an aborted request even if its scope and revision still match", () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      isCurrentSkillRequest(
        {
          scopeId: "project-a",
          revision: 4,
          key: "recipe-a",
          signal: controller.signal,
        },
        { scopeId: "project-a", revision: 4, key: "recipe-a" },
      ),
    ).toBe(false);
  });

  it("keeps actionable RPC errors and provides a fallback for non-Error values", () => {
    expect(skillRequestErrorMessage(new Error("网络不可用"), "刷新失败")).toBe(
      "网络不可用",
    );
    expect(skillRequestErrorMessage("unknown", "刷新失败")).toBe("刷新失败");
  });
});
