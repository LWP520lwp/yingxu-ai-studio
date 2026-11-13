import { describe, expect, it } from "vitest";
import { createPluginMutationSession } from "@/atlas-engine/plugins/mutation-session";

describe("plugin mutation ownership", () => {
  it("rejects a second change before the first busy state has rendered", () => {
    const session = createPluginMutationSession();
    const importing = session.begin();
    expect(importing).not.toBeNull();
    expect(session.begin()).toBeNull();
    expect(session.finish(importing!)).toBe(true);
    expect(session.begin()).not.toBeNull();
  });

  it("ignores a stale completion rather than unlocking a newer plugin change", () => {
    const session = createPluginMutationSession();
    const first = session.begin()!;
    session.finish(first);
    const second = session.begin()!;
    expect(session.finish(first)).toBe(false);
    expect(session.begin()).toBeNull();
    expect(session.finish(second)).toBe(true);
    expect(session.begin()).not.toBeNull();
  });
});
