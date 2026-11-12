import { describe, expect, it } from "vitest";

import {
  formatPromptSourceTime,
  promptSourceHealth,
  promptSourceIntervalKey,
} from "@/lib/prompt-source-view-model";
import type { PromptSourceStatus } from "@/services/api/prompts";

const status: PromptSourceStatus = {
  sourceId: "source-a",
  count: 8,
  lastSuccessAt: "2026-11-11T08:30:00.000Z",
  lastError: "",
};

describe("prompt source view model", () => {
  it("gives source errors precedence over a previous successful fetch", () => {
    expect(promptSourceHealth(status)).toBe("healthy");
    expect(promptSourceHealth({ ...status, lastError: "timeout" })).toBe(
      "failed",
    );
    expect(promptSourceHealth(undefined)).toBe("unsynced");
    expect(
      promptSourceHealth({ ...status, lastSuccessAt: "", lastError: "" }),
    ).toBe("unsynced");
  });

  it("maps supported schedule intervals to their localized option keys", () => {
    expect([0, 30, 60, 360, 1440, 15].map(promptSourceIntervalKey)).toEqual([
      "disabled",
      "minutes30",
      "hour1",
      "hours6",
      "hours24",
      "disabled",
    ]);
  });

  it("returns a placeholder instead of an invalid locale date", () => {
    expect(formatPromptSourceTime("not-a-date", "zh-CN")).toBe("-");
    expect(formatPromptSourceTime(status.lastSuccessAt, "zh-CN")).not.toBe("-");
  });
});
