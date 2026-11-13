import { describe, expect, it } from "vitest";
import { codexPlanningSnapshot, normalizeCodexBridgeEndpoint, parseCodexCanvasPlan } from "@/atlas-engine/studio/codex-plan";
import { CanvasNodeType } from "@/types/canvas";

const draft = () => ({ summary: "连续镜头", nodes: [
  { id: "intro", type: "text", title: "开场", content: "科学问题", prompt: "", x: 0, y: 0, mode: "text" },
  { id: "shot", type: "config", title: "镜头一", content: "", prompt: "近景观察水珠", x: 420, y: 0, mode: "video" },
], connections: [{ from: "intro", to: "shot" }] });

describe("Codex canvas proposals", () => {
  it("accepts a bounded proposal of additions and returns a detached plan", () => {
    const source = draft(); const result = parseCodexCanvasPlan(source);
    expect(result).toEqual(source);
    result.nodes[0].title = "修改";
    expect(source.nodes[0].title).toBe("开场");
  });
  it.each([
    (value: ReturnType<typeof draft>) => { value.nodes[1].id = "intro"; },
    (value: ReturnType<typeof draft>) => { value.connections[0].to = "existing-node"; },
    (value: ReturnType<typeof draft>) => { value.connections[0].to = "intro"; },
    (value: ReturnType<typeof draft>) => { value.nodes[0].x = Infinity; },
    (value: ReturnType<typeof draft>) => { value.nodes[0].y = 20001; },
    (value: ReturnType<typeof draft>) => { value.nodes[0].type = "shell"; },
    (value: ReturnType<typeof draft>) => { value.nodes[0].content = "https://example.com/payload"; },
    (value: ReturnType<typeof draft>) => { Object.assign(value.nodes[0], { metadata: { apiKey: "unexpected" } }); },
    (value: ReturnType<typeof draft>) => { value.nodes[0].title = ""; },
    (value: ReturnType<typeof draft>) => { value.connections.push({ ...value.connections[0] }); },
  ])("rejects unsafe or ambiguous proposals", (mutate) => {
    const value = draft(); mutate(value); expect(() => parseCodexCanvasPlan(value)).toThrow();
  });
  it("requires at least one node and rejects over-sized plans", () => {
    expect(() => parseCodexCanvasPlan({ summary: "", nodes: [], connections: [] })).toThrow();
    const value = draft(); value.nodes = Array.from({ length: 41 }, (_, index) => ({ ...value.nodes[0], id: `n${index}` }));
    expect(() => parseCodexCanvasPlan(value)).toThrow();
  });
  it("guards all displayed text fields against credentials and unsafe URLs", () => {
    const unsafe = [
      `github_pat_${"A".repeat(40)}`,
      `Bearer ${"b".repeat(24)}+/==`,
      `ghp_${"c".repeat(24)}`,
      `sk-${"d".repeat(24)}`,
      "-----BEGIN RSA PRIVATE KEY-----",
      "https://example.test/secret",
    ];
    for (const field of ["summary", "title", "content", "prompt"] as const) {
      for (const text of unsafe) {
        const value = draft();
        if (field === "summary") value.summary = text;
        else value.nodes[0][field] = text;
        expect(() => parseCodexCanvasPlan(value)).toThrow();
      }
    }
    const text = "解释 metadata: 字段及 Bearer authentication 授权的含义";
    const value = draft(); value.summary = text;
    Object.assign(value.nodes[0], { title: text, content: text, prompt: text });
    expect(parseCodexCanvasPlan(value)).toEqual(value);
  });
  it("restricts connection endpoints to local HTTP and rejects embedded credentials", () => {
    expect(normalizeCodexBridgeEndpoint("http://127.0.0.1:4599/")).toBe("http://127.0.0.1:4599");
    for (const address of ["https://example.com", "http://localhost:4599/turn", "http://user:pass@localhost:4599", "http://localhost:4599?token=secret"]) expect(() => normalizeCodexBridgeEndpoint(address)).toThrow();
  });
  it("shares bounded text context without media or secret metadata", () => {
    const secret = `sk-${"a".repeat(36)}`;
    const value = codexPlanningSnapshot({ nodes: [
      { id: "text", type: CanvasNodeType.Text, title: "资料", position: { x: 0, y: 0 }, width: 300, height: 200, metadata: { content: `内容 ${secret}` } },
      { id: "image", type: CanvasNodeType.Image, title: "图像", position: { x: 0, y: 0 }, width: 300, height: 200, metadata: { content: "data:image/png;base64,private", storageKey: "private-key", model: "private-model" } },
    ], connections: [{ id: "edge", fromNodeId: "text", toNodeId: "image" }] });
    expect(JSON.stringify(value)).not.toContain(secret);
    expect(JSON.stringify(value)).not.toContain("private");
    expect(value.nodes[0].content).toContain("[credential removed]");
    expect(value.connections).toEqual([{ from: "text", to: "image" }]);
  });
});
