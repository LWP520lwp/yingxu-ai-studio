import { describe, expect, it } from "vitest";

import { createPluginOperationClock } from "@/atlas-engine/plugins/operation-gate";

describe("plugin operation gate", () => {
  it("lets the latest request for a plugin win even when it resolves first", () => {
    const gate = createPluginOperationClock();
    const oldInstall = gate.begin();
    const newInstall = gate.begin();

    expect(gate.claim("studio:node", newInstall)).toBe(true);
    expect(gate.claim("studio:node", oldInstall)).toBe(false);
    expect(gate.isCurrent("studio:node", newInstall)).toBe(true);
  });

  it("cancels an in-flight install after disable or uninstall", () => {
    const gate = createPluginOperationClock();
    const install = gate.begin();
    gate.beginFor("studio:node");

    expect(gate.claim("studio:node", install)).toBe(false);
  });

  it("keeps operations for different plugins independent", () => {
    const gate = createPluginOperationClock();
    const first = gate.begin();
    gate.beginFor("other:node");

    expect(gate.claim("studio:node", first)).toBe(true);
  });
});
