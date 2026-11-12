import { describe, expect, it } from "vitest";

import { createPluginOperationGate } from "@/lib/canvas/plugin-operation-gate";

describe("plugin operation gate", () => {
  it("lets the latest request for a plugin win even when it resolves first", () => {
    const gate = createPluginOperationGate();
    const oldInstall = gate.begin();
    const newInstall = gate.begin();

    expect(gate.claim("studio:node", newInstall)).toBe(true);
    expect(gate.claim("studio:node", oldInstall)).toBe(false);
    expect(gate.isCurrent("studio:node", newInstall)).toBe(true);
  });

  it("cancels an in-flight install after disable or uninstall", () => {
    const gate = createPluginOperationGate();
    const install = gate.begin();
    gate.beginFor("studio:node");

    expect(gate.claim("studio:node", install)).toBe(false);
  });

  it("keeps operations for different plugins independent", () => {
    const gate = createPluginOperationGate();
    const first = gate.begin();
    gate.beginFor("other:node");

    expect(gate.claim("studio:node", first)).toBe(true);
  });
});
