import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

export type CodexCanvasPlan = {
  summary: string;
  nodes: Array<{
    id: string;
    type: "text" | "config" | "image" | "video";
    title: string;
    content: string;
    prompt: string;
    x: number;
    y: number;
    mode: "image" | "video" | "text";
  }>;
  connections: Array<{ from: string; to: string }>;
};

function hasKeys(
  value: unknown,
  keys: string[],
): value is Record<string, unknown> {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key)),
  );
}

function isText(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.length <= limit;
}

const unsafeText =
  /(?:\b(?:https?:\/\/|data:|javascript:|file:)|-----BEGIN [^-\r\n]*PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{20,})\b|\bBearer[ \t]+[A-Za-z0-9._~+/-]{20,}={0,2})/i;

/** Accepts additions only. Generated metadata, URLs and arbitrary commands never enter the document. */
export function parseCodexCanvasPlan(value: unknown): CodexCanvasPlan {
  if (
    !hasKeys(value, ["summary", "nodes", "connections"]) ||
    !isText(value.summary, 2000) ||
    unsafeText.test(value.summary)
  )
    throw new Error("Invalid Codex plan");
  if (
    !Array.isArray(value.nodes) ||
    value.nodes.length < 1 ||
    value.nodes.length > 40 ||
    !Array.isArray(value.connections) ||
    value.connections.length > 160
  )
    throw new Error("Invalid Codex plan size");
  const ids = new Set<string>();
  const nodes: CodexCanvasPlan["nodes"] = value.nodes.map((node: unknown) => {
    if (
      !hasKeys(node, [
        "id",
        "type",
        "title",
        "content",
        "prompt",
        "x",
        "y",
        "mode",
      ]) ||
      typeof node.id !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(node.id) ||
      ids.has(node.id)
    )
      throw new Error("Invalid Codex node ID");
    if (
      !["text", "config", "image", "video"].includes(String(node.type)) ||
      !["image", "video", "text"].includes(String(node.mode))
    )
      throw new Error("Unsupported Codex node kind");
    if (
      !isText(node.title, 160) ||
      !node.title.trim() ||
      !isText(node.content, 16000) ||
      !isText(node.prompt, 16000) ||
      [node.title, node.content, node.prompt].some((item) =>
        unsafeText.test(item),
      )
    )
      throw new Error("Invalid Codex node text");
    if (
      typeof node.x !== "number" ||
      typeof node.y !== "number" ||
      !Number.isFinite(node.x) ||
      !Number.isFinite(node.y) ||
      Math.abs(node.x) > 20000 ||
      Math.abs(node.y) > 20000
    )
      throw new Error("Invalid Codex node coordinates");
    ids.add(node.id);
    return {
      id: node.id,
      type: node.type as CodexCanvasPlan["nodes"][number]["type"],
      title: node.title,
      content: node.content,
      prompt: node.prompt,
      x: node.x,
      y: node.y,
      mode: node.mode as CodexCanvasPlan["nodes"][number]["mode"],
    };
  });
  const pairs = new Set<string>();
  const connections: CodexCanvasPlan["connections"] = value.connections.map(
    (edge: unknown) => {
      if (
        !hasKeys(edge, ["from", "to"]) ||
        typeof edge.from !== "string" ||
        typeof edge.to !== "string" ||
        !ids.has(edge.from) ||
        !ids.has(edge.to) ||
        edge.from === edge.to ||
        pairs.has(`${edge.from}\0${edge.to}`)
      )
        throw new Error("Invalid Codex connection");
      pairs.add(`${edge.from}\0${edge.to}`);
      return { from: edge.from, to: edge.to };
    },
  );
  return { summary: value.summary, nodes, connections };
}

export function normalizeCodexBridgeEndpoint(value: string): string {
  const url = new URL(value.trim());
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  )
    throw new Error(
      "Use a local HTTP bridge address, such as http://127.0.0.1:4599",
    );
  return url.origin;
}

function redact(value: string | undefined, limit: number) {
  return (value || "")
    .slice(0, limit)
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{20,})\b/g,
      "[credential removed]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~-]{12,}/gi, "[credential removed]")
    .replace(/data:[^\s]+/gi, "[media omitted]");
}

export function codexPlanningSnapshot(snapshot: {
  nodes: CanvasNodeData[];
  connections: CanvasConnection[];
}) {
  return {
    nodes: snapshot.nodes
      .slice(0, 100)
      .map((node) => ({
        id: node.id,
        type: node.type,
        title: redact(node.title, 160),
        content:
          node.type === "text" ? redact(node.metadata?.content, 2000) : "",
        prompt: redact(
          node.metadata?.composerContent || node.metadata?.prompt,
          2000,
        ),
      })),
    connections: snapshot.connections
      .slice(0, 200)
      .map((edge) => ({ from: edge.fromNodeId, to: edge.toNodeId })),
  };
}
