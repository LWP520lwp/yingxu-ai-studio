const nodeKinds = ["text", "config", "image", "video"];
const modes = ["image", "video", "text"];
const shortText = { type: "string", maxLength: 160 };
const longText = { type: "string", maxLength: 16000 };

export const PLAN_SCHEMA = {
  type: "object", additionalProperties: false, required: ["summary", "nodes", "connections"],
  properties: {
    summary: { type: "string", maxLength: 2000 },
    nodes: {
      type: "array", minItems: 1, maxItems: 40,
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "type", "title", "content", "prompt", "x", "y", "mode"],
        properties: {
          id: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_-]{0,63}$" },
          type: { type: "string", enum: nodeKinds }, title: shortText,
          content: longText, prompt: longText,
          x: { type: "number", minimum: -20000, maximum: 20000 },
          y: { type: "number", minimum: -20000, maximum: 20000 },
          mode: { type: "string", enum: modes },
        },
      },
    },
    connections: {
      type: "array", maxItems: 160,
      items: {
        type: "object", additionalProperties: false, required: ["from", "to"],
        properties: { from: shortText, to: shortText },
      },
    },
  },
};

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const keysEqual = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const text = (value, max) => typeof value === "string" && value.length <= max;
const safeCopy = (value) => !/(?:\b(?:https?:\/\/|data:|javascript:|file:)|-----BEGIN [^-\r\n]*PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{20,})\b|\bBearer[ \t]+[A-Za-z0-9._~+/-]{20,}={0,2})/i.test(value);
const redact = (value) => value.replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{20,})\b/g, "[credential removed]").replace(/\bBearer\s+[A-Za-z0-9._~-]{12,}/gi, "[credential removed]").replace(/data:[^\s]+/gi, "[media omitted]");

export function validatePlan(value) {
  if (!keysEqual(value, ["summary", "nodes", "connections"]) || !text(value.summary, 2000) || !safeCopy(value.summary)) throw new Error("Codex returned an invalid plan envelope");
  if (!Array.isArray(value.nodes) || value.nodes.length < 1 || value.nodes.length > 40 || !Array.isArray(value.connections) || value.connections.length > 160) throw new Error("Codex plan exceeds the canvas item limit");
  const ids = new Set();
  const nodes = value.nodes.map((node) => {
    if (!keysEqual(node, ["id", "type", "title", "content", "prompt", "x", "y", "mode"]) || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(node.id) || ids.has(node.id)) throw new Error("Codex plan contains an invalid or duplicate node ID");
    if (!nodeKinds.includes(node.type) || !modes.includes(node.mode) || !text(node.title, 160) || !node.title.trim() || !text(node.content, 16000) || !text(node.prompt, 16000)) throw new Error("Codex plan contains unsupported node content");
    if (![node.x, node.y].every((v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 20000)) throw new Error("Codex plan contains invalid coordinates");
    if (![node.title, node.content, node.prompt].every(safeCopy)) throw new Error("Codex plan must contain plain canvas text without URLs or credentials");
    ids.add(node.id);
    return { ...node };
  });
  const pairs = new Set();
  const connections = value.connections.map((edge) => {
    if (!keysEqual(edge, ["from", "to"]) || !ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to || pairs.has(`${edge.from}\0${edge.to}`)) throw new Error("Codex plan contains an invalid connection");
    pairs.add(`${edge.from}\0${edge.to}`);
    return { from: edge.from, to: edge.to };
  });
  return { summary: value.summary, nodes, connections };
}

export function sanitizeTurnInput(value) {
  if (!object(value) || !text(value.prompt, 12000) || !value.prompt.trim() || !text(value.model, 200) || !value.model.trim()) throw new Error("A prompt and an available model are required");
  const snapshot = object(value.snapshot) ? value.snapshot : {};
  const nodes = Array.isArray(snapshot.nodes) ? snapshot.nodes.slice(0, 100).map((node) => ({
    id: typeof node.id === "string" ? node.id.slice(0, 100) : "",
    type: typeof node.type === "string" ? node.type.slice(0, 50) : "",
    title: typeof node.title === "string" ? redact(node.title.slice(0, 160)) : "",
    content: typeof node.content === "string" ? redact(node.content.slice(0, 2000)) : "",
    prompt: typeof node.prompt === "string" ? redact(node.prompt.slice(0, 2000)) : "",
  })) : [];
  const connections = Array.isArray(snapshot.connections) ? snapshot.connections.slice(0, 200).map((edge) => ({
    from: typeof edge.from === "string" ? edge.from.slice(0, 100) : "",
    to: typeof edge.to === "string" ? edge.to.slice(0, 100) : "",
  })) : [];
  return { prompt: redact(value.prompt.trim()), model: value.model.trim(), snapshot: { nodes, connections } };
}
