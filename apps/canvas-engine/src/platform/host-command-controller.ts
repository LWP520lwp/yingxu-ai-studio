export type HostCommand =
  | { command: "flush"; requestId: string | null }
  | { command: "export" }
  | { command: "upload" };

export type HostCommandBoundary = {
  parent: MessageEventSource;
  origin: string;
  scopeId: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function decodeHostCommand(event: MessageEvent, boundary: HostCommandBoundary): HostCommand | null {
  if (event.source !== boundary.parent || event.origin !== boundary.origin || !isObject(event.data)) return null;
  const message = event.data;
  if (message.type !== "frameflow:command" || message.scopeId !== boundary.scopeId) return null;
  if (message.command === "save" || message.command === "flush") {
    const id = typeof message.id === "string" && message.id.length > 0 && message.id.length <= 128
      ? message.id
      : null;
    return { command: "flush", requestId: id };
  }
  if (message.command === "export") return { command: "export" };
  if (message.command === "upload") return { command: "upload" };
  return null;
}

export class FlushRequestLedger {
  private readonly requests = new Map<string, Promise<boolean>>();

  constructor(private readonly limit = 100) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("保存请求容量必须是正整数");
  }

  run(requestId: string | null, flush: () => Promise<boolean>): Promise<boolean> {
    if (!requestId) return Promise.resolve().then(flush);
    const existing = this.requests.get(requestId);
    if (existing) return existing;
    const request = Promise.resolve().then(flush);
    this.requests.set(requestId, request);
    if (this.requests.size > this.limit) this.requests.delete(this.requests.keys().next().value!);
    return request;
  }

  clear() {
    this.requests.clear();
  }
}
