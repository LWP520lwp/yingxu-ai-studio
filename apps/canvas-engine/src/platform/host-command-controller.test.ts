import { describe, expect, it, vi } from "vitest";
import { decodeHostCommand, FlushRequestLedger } from "./host-command-controller";

const parent = {} as MessageEventSource;
const boundary = { parent, origin: "https://studio.example", scopeId: "scope-1" };
const message = (command: string, id?: unknown, overrides: Record<string, unknown> = {}) => ({
  source: parent,
  origin: boundary.origin,
  data: { type: "frameflow:command", scopeId: boundary.scopeId, command, id, ...overrides },
}) as unknown as MessageEvent;

describe("canvas host command boundary", () => {
  it("accepts only commands from the active host origin and project scope", () => {
    expect(decodeHostCommand(message("flush", "save-1"), boundary)).toEqual({ command: "flush", requestId: "save-1" });
    expect(decodeHostCommand({ ...message("export"), origin: "https://other.example" }, boundary)).toBeNull();
    expect(decodeHostCommand(message("upload", undefined, { scopeId: "other-scope" }), boundary)).toBeNull();
    expect(decodeHostCommand({ ...message("export"), source: {} as MessageEventSource }, boundary)).toBeNull();
    expect(decodeHostCommand(message("navigate"), boundary)).toBeNull();
  });

  it("coalesces repeated save IDs and bounds retained responses", async () => {
    const ledger = new FlushRequestLedger(2);
    const flush = vi.fn(async () => true);
    const first = ledger.run("a", flush);
    expect(ledger.run("a", flush)).toBe(first);
    await first;
    ledger.run("b", flush);
    ledger.run("c", flush);
    expect(ledger.run("a", flush)).not.toBe(first);
    await Promise.resolve();
    expect(flush).toHaveBeenCalledTimes(4);
    ledger.clear();
    expect(await ledger.run("c", async () => false)).toBe(false);
  });

  it("does not cache anonymous or malformed request IDs", async () => {
    const ledger = new FlushRequestLedger();
    const flush = vi.fn(async () => true);
    const invalid = decodeHostCommand(message("flush", "x".repeat(129)), boundary);
    expect(invalid).toEqual({ command: "flush", requestId: null });
    await Promise.all([ledger.run(null, flush), ledger.run(null, flush)]);
    expect(flush).toHaveBeenCalledTimes(2);
  });
});
