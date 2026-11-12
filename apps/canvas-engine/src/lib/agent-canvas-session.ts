import { executeAgentCanvasTransaction, type AgentGenerationRequest } from "./agent-canvas-bridge";
import type { CanvasAgentOp, CanvasAgentSnapshot } from "./canvas/canvas-agent-ops";

type SessionPort = {
  read: () => CanvasAgentSnapshot;
  write: (snapshot: CanvasAgentSnapshot) => void;
  generate: (request: AgentGenerationRequest) => void;
  historyChanged: (canUndo: boolean) => void;
};

/** One mounted project owns one session; retired callbacks cannot mutate another project. */
export class CanvasAgentSession {
  private before: CanvasAgentSnapshot | null = null;
  private retired = false;
  private epoch = 0;

  constructor(private readonly port: SessionPort) {}

  apply(operations?: CanvasAgentOp[]) {
    const current = this.port.read();
    if (this.retired) return current;
    const transaction = executeAgentCanvasTransaction(current, operations);
    if (transaction.changed) {
      this.before = current;
      this.port.write(transaction.after);
      this.port.historyChanged(true);
    }
    if (transaction.generation.length) {
      const epoch = this.epoch;
      queueMicrotask(() => {
        if (this.retired || this.epoch !== epoch) return;
        for (const request of transaction.generation) this.port.generate(request);
      });
    }
    return transaction.after;
  }

  undo() {
    if (this.retired || !this.before) return null;
    const snapshot = this.before;
    this.before = null;
    this.port.write(snapshot);
    this.port.historyChanged(false);
    return snapshot;
  }

  activate() { this.retired = false; }

  retire() {
    this.epoch++;
    this.retired = true;
    this.before = null;
  }
}
