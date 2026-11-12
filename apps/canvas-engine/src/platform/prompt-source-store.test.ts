import { afterEach, describe, expect, it } from "vitest";

import {
  PROMPT_SOURCE_INTERVALS,
  usePromptSourceStore,
} from "@/stores/use-prompt-source-store";

afterEach(() => {
  usePromptSourceStore.setState({
    sources: [],
    schedule: { intervalMinutes: 30, lastFetchedAt: "" },
  });
});

describe("prompt source store", () => {
  it("returns a draft source without persisting until it is saved", () => {
    usePromptSourceStore.setState({ sources: [] });
    const draft = usePromptSourceStore.getState().addSource();
    expect(draft.id).toBeTruthy();
    expect(usePromptSourceStore.getState().sources).toEqual([]);
  });

  it("keeps built-in entries protected while accepting custom entries", () => {
    const builtIn = {
      id: "built-in",
      name: "Built in",
      url: "https://example.test/builtin.json",
      homepage: "https://example.test",
      enabled: true,
      builtIn: true,
    };
    const custom = { ...builtIn, id: "custom", name: "Custom", builtIn: false };
    usePromptSourceStore.setState({ sources: [builtIn] });
    usePromptSourceStore.getState().saveSource(custom);
    usePromptSourceStore.getState().removeSource("built-in");
    expect(usePromptSourceStore.getState().sources).toEqual([builtIn, custom]);
    usePromptSourceStore.getState().removeSource("custom");
    expect(usePromptSourceStore.getState().sources).toEqual([builtIn]);
  });

  it("normalizes unsupported schedules to the documented interval", () => {
    usePromptSourceStore.getState().updateSchedule("intervalMinutes", 7);
    expect(usePromptSourceStore.getState().schedule.intervalMinutes).toBe(30);
    usePromptSourceStore.getState().updateSchedule("intervalMinutes", PROMPT_SOURCE_INTERVALS[2]);
    expect(usePromptSourceStore.getState().schedule.intervalMinutes).toBe(60);
    usePromptSourceStore.getState().updateSchedule("lastFetchedAt", "a".repeat(100));
    expect(usePromptSourceStore.getState().schedule.lastFetchedAt).toHaveLength(40);
  });
});
