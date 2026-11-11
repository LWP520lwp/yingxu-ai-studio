import type { WorkbenchDocument, WorkbenchDocumentCommand } from "@/lib/canvas/workbench-document";

/** Commands understood by the host application. UI components only depend on this contract. */
export type WorkbenchCommand =
    | { method: "canvas.document.read"; params: { projectId: string } }
    | { method: "canvas.document.commit"; params: { projectId: string; baseRevision: number; command: WorkbenchDocumentCommand } }
    | { method: "canvas.models.refresh"; params: Record<string, never> }
    | { method: "canvas.assets.list"; params: { projectId: string } };

export type WorkbenchCommandResult = {
    "canvas.document.read": { document: WorkbenchDocument | null; revision: number };
    "canvas.document.commit": { document: WorkbenchDocument; revision: number };
    "canvas.models.refresh": { image: unknown[]; video: unknown[] };
    "canvas.assets.list": { assets: unknown[] };
};

export type CommandEnvelope = WorkbenchCommand & { id: string; scopeId: string };

const METHODS = new Set<WorkbenchCommand["method"]>([
    "canvas.document.read",
    "canvas.document.commit",
    "canvas.models.refresh",
    "canvas.assets.list",
]);

export function createCommandEnvelope<T extends WorkbenchCommand>(scopeId: string, command: T, id = crypto.randomUUID()): CommandEnvelope {
    if (!scopeId.trim()) throw new Error("画布作用域不能为空");
    if (!METHODS.has(command.method)) throw new Error("未知的画布命令");
    return { ...command, id, scopeId } as CommandEnvelope;
}

export function isCommandEnvelope(value: unknown): value is CommandEnvelope {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Record<string, unknown>;
    return typeof candidate.id === "string" && Boolean(candidate.id) && typeof candidate.scopeId === "string" && Boolean(candidate.scopeId) && typeof candidate.method === "string" && METHODS.has(candidate.method as WorkbenchCommand["method"]) && Boolean(candidate.params && typeof candidate.params === "object");
}

export function methodResult<M extends WorkbenchCommand["method"]>(method: M, value: unknown): WorkbenchCommandResult[M] {
    return value as WorkbenchCommandResult[M];
}
