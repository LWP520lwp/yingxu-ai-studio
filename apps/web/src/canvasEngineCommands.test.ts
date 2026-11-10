import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canvasInitialTitle, createCanvasCommandChannel } from "./CanvasEngine";

let channels: ReturnType<typeof createCanvasCommandChannel>[] = [];
const open = () => {
  const send = vi.fn(); const onError = vi.fn(); const onStatus = vi.fn();
  const channel = createCanvasCommandChannel({ scopeId: "project-one-scope", send, onError, onStatus, timeoutMs: 5000 });
  channels.push(channel);
  return { channel, send, onError, onStatus };
};
const ack = (id: string, scopeId = "project-one-scope", saved = true) => ({
  type: "frameflow:command-response", id, scopeId, command: "flush", ok: saved, result: { saved },
  error: saved ? undefined : { message: "服务器版本冲突，本机草稿已保留" },
});
beforeEach(() => { channels = []; vi.useFakeTimers(); });
afterEach(() => { channels.forEach((channel) => channel.dispose()); vi.useRealTimers(); });

describe("native draft titles", () => {
  it("keeps a library rename when the legacy project title is stale", () => {
    expect(canvasInitialTitle({ document: { title: "草稿库中重命名" } }, "旧共享项目名")).toBe("草稿库中重命名");
  });
  it("falls back for old snapshots without a valid name", () => {
    for (const snapshot of [null, {}, { document: null }, { document: { title: 3 } }, { document: { title: "  " } }])
      expect(canvasInitialTitle(snapshot, "旧版草稿")).toBe("旧版草稿");
  });
});

describe("canvas save confirmation channel", () => {
  it("acknowledges workflow insertion separately before saving and ignores foreign replies", async () => {
    const { channel, send } = open();
    const applied = channel.request("storyWorkflow", { segmentId: "segment-one" });
    channel.markMounted();
    const command = send.mock.calls[0][0];
    channel.receive({ ...ack(command.id, "foreign"), command: "storyWorkflow" });
    channel.receive({ ...ack(command.id), command: "storyWorkflow", result: { applied: true } });
    expect(await applied).toBe(true);
    const saving = channel.flush();
    channel.receive(ack(send.mock.calls[1][0].id));
    expect(await saving).toBe(true);
  });
  it("does not replay timed-out workflow commands or carry them into another project", async () => {
    const { channel, send } = open();
    const applied = channel.request("storyWorkflow", {});
    await vi.advanceTimersByTimeAsync(5000);
    expect(await applied).toBe(false);
    channel.markMounted();
    expect(send).not.toHaveBeenCalled();
    const next = channel.request("storyWorkflow", {});
    channel.dispose();
    expect(await next).toBe(false);
  });
  it("waits for the mounted editing surface and resolves only an acknowledged save", async () => {
    const { channel, send } = open();
    const saving = channel.flush();
    expect(channel.isReady()).toBe(false);
    expect(send).not.toHaveBeenCalled();
    channel.markMounted();
    expect(channel.isReady()).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    const request = send.mock.calls[0][0];
    expect(request).toMatchObject({ type: "frameflow:command", scopeId: "project-one-scope", command: "flush" });
    channel.receive(ack(request.id));
    expect(await saving).toBe(true);
  });

  it("ignores confirmations from another scope or a different command", async () => {
    const { channel, send, onError } = open();
    channel.markMounted();
    const saving = channel.flush();
    const request = send.mock.calls[0][0];
    channel.receive(ack(request.id, "other-project"));
    channel.receive({ ...ack(request.id), command: "export" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await saving).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("超时"));
  });

  it("propagates save failure instead of acknowledging a project switch", async () => {
    const { channel, send, onError } = open();
    channel.markMounted();
    const saving = channel.flush();
    channel.receive(ack(send.mock.calls[0][0].id, "project-one-scope", false));
    expect(await saving).toBe(false);
    expect(onError).toHaveBeenCalledWith("服务器版本冲突，本机草稿已保留");
  });

  it("coalesces simultaneous callers and does not submit parallel flushes", async () => {
    const { channel, send } = open();
    channel.markMounted();
    const first = channel.flush(); const second = channel.flush();
    expect(first).toBe(second);
    expect(send).toHaveBeenCalledOnce();
    channel.receive(ack(send.mock.calls[0][0].id));
    expect(await first).toBe(true);
    expect(await second).toBe(true);
  });

  it("removes timed-out queued flushes before a late ready signal", async () => {
    const { channel, send } = open();
    const saving = channel.flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await saving).toBe(false);
    channel.markMounted();
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects outstanding saves and discards all commands when its project unmounts", async () => {
    const { channel, send } = open();
    channel.command("insert", { title: "原项目素材" });
    const saving = channel.flush();
    channel.dispose();
    expect(channel.isReady()).toBe(false);
    channel.markMounted();
    expect(await saving).toBe(false);
    expect(await channel.flush()).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
