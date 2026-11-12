import { describe, expect, it, vi } from "vitest";

import {
  normalizeAgentEndpoint,
  persistAgentConnection,
  readAgentPreferences,
  type PreferenceStorage,
} from "@/lib/agent-preferences";

describe("local agent preferences", () => {
  it("uses safe defaults when storage is unavailable or contains invalid modes", () => {
    expect(readAgentPreferences(null)).toMatchObject({
      url: "http://127.0.0.1:17371",
      permissionMode: "request",
      reasoningEffort: "",
    });
    const storage: PreferenceStorage = {
      getItem: (key) =>
        key === "canvas-agent-permission-mode" ? "admin" : "imaginative",
      setItem: () => undefined,
    };
    expect(readAgentPreferences(storage)).toMatchObject({
      permissionMode: "request",
      reasoningEffort: "",
    });
  });

  it("accepts HTTP endpoints without embedded credentials and normalizes their slash", () => {
    expect(normalizeAgentEndpoint(" http://localhost:17371/ ")).toBe(
      "http://localhost:17371",
    );
    expect(normalizeAgentEndpoint("https://agent.example/path/")).toBe(
      "https://agent.example/path",
    );
    expect(normalizeAgentEndpoint("javascript:alert(1)")).toBeNull();
    expect(normalizeAgentEndpoint("https://user:pass@agent.example")).toBeNull();
  });

  it("keeps the connection usable if saving its preferences throws", () => {
    const storage: PreferenceStorage = {
      getItem: () => null,
      setItem: vi.fn(() => {
        throw new DOMException("blocked", "SecurityError");
      }),
    };
    expect(
      persistAgentConnection(storage, "http://localhost:17371", "token"),
    ).toBe(false);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });
});
