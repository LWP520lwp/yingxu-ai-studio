import { afterEach, describe, expect, it } from "vitest";

import { buildCanvasResourceReferences, buildNodeMentionReferences, getGenerationResourceNodes, getGroupResourceNodes, getMentionResourceNodes, isCanvasReferenceNode } from "@/lib/canvas/canvas-resource-references";
import { registerNodeDefinitions, unregisterPluginNodes } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

const node = (id: string, type: CanvasNodeData["type"], metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData => ({
    id,
    type,
    title: id,
    position: { x: 0, y: 0 },
    width: 200,
    height: 120,
    metadata,
});

const edge = (fromNodeId: string, toNodeId: string, id = `${fromNodeId}-${toNodeId}`): CanvasConnection => ({ id, fromNodeId, toNodeId });

afterEach(() => unregisterPluginNodes("resource-reference-test"));

describe("canvas resource references", () => {
    it("indexes built-in image, video, audio, and text resources in canvas order", () => {
        const nodes = [
            node("image", CanvasNodeType.Image, { content: "data:image/png;base64,AA==" }),
            node("video", CanvasNodeType.Video, { content: "https://media.example/video.mp4" }),
            node("audio", CanvasNodeType.Audio, { content: "https://media.example/audio.mp3" }),
            node("text", CanvasNodeType.Text, { prompt: "A saved text prompt" }),
        ];

        expect(buildCanvasResourceReferences(nodes).map(({ nodeId, kind, text, previewUrl }) => ({ nodeId, kind, text, previewUrl }))).toEqual([
            { nodeId: "image", kind: "image", text: undefined, previewUrl: "data:image/png;base64,AA==" },
            { nodeId: "video", kind: "video", text: undefined, previewUrl: "https://media.example/video.mp4" },
            { nodeId: "audio", kind: "audio", text: undefined, previewUrl: "https://media.example/audio.mp3" },
            { nodeId: "text", kind: "text", text: "A saved text prompt", previewUrl: undefined },
        ]);
    });

    it("includes plugin resources nested in groups while stopping cyclic and duplicate membership", () => {
        registerNodeDefinitions([{
            type: "demo:resource-source",
            title: "Plugin source",
            icon: null,
            defaultSize: { width: 200, height: 120 },
            resource: (item) => ({ kind: "text", text: item.metadata?.content, url: "https://plugin.example/source" }),
        }], "resource-reference-test");

        const nodes = [
            node("outer", CanvasNodeType.Group, { groupId: "cycle" }),
            node("inner", CanvasNodeType.Group, { groupId: "outer" }),
            node("deep", CanvasNodeType.Group, { groupId: "inner" }),
            node("photo", CanvasNodeType.Image, { groupId: "inner", content: "data:image/jpeg;base64,AA==" }),
            node("plugin", "demo:resource-source", { groupId: "deep", content: "Plugin-provided text" }),
            node("cycle", CanvasNodeType.Group, { groupId: "deep" }),
            node("outside", CanvasNodeType.Text, { content: "not a group member" }),
        ];
        const connections = [edge("outer", "target"), edge("outer", "target", "duplicate-edge"), edge("missing", "target")];

        expect(getGroupResourceNodes("outer", nodes).map(({ id }) => id)).toEqual(["photo", "plugin"]);
        expect(isCanvasReferenceNode(nodes[0], nodes)).toBe(true);
        expect(isCanvasReferenceNode(nodes[6], nodes)).toBe(true);
        expect(getMentionResourceNodes("target", nodes, connections).map(({ id }) => id)).toEqual(["photo", "plugin"]);
        expect(buildNodeMentionReferences(node("target", CanvasNodeType.Text), nodes, connections).map(({ nodeId }) => nodeId)).toEqual(["photo", "plugin"]);
        expect(buildNodeMentionReferences(node("outer", CanvasNodeType.Group), nodes, []).map(({ nodeId }) => nodeId)).toEqual([]);
    });

    it("uses the connected configuration inputs before direct inputs and expands nested group references for mentions", () => {
        const nodes = [
            node("target", CanvasNodeType.Video),
            node("direct", CanvasNodeType.Image, { content: "data:image/png;base64,AA==" }),
            node("config", CanvasNodeType.Config),
            node("configured-image", CanvasNodeType.Image, { content: "data:image/webp;base64,AA==" }),
            node("configured-group", CanvasNodeType.Group),
            node("configured-audio", CanvasNodeType.Audio, { groupId: "configured-group", content: "https://media.example/configured.mp3" }),
        ];
        const connections = [
            edge("direct", "target"),
            edge("target", "config"),
            edge("configured-image", "config"),
            edge("configured-group", "config"),
            edge("configured-image", "config", "duplicate-config-input"),
        ];

        expect(getGenerationResourceNodes("target", nodes, connections).map(({ id }) => id)).toEqual(["configured-image", "configured-group"]);
        expect(getMentionResourceNodes("target", nodes, connections).map(({ id }) => id)).toEqual(["configured-image", "configured-audio"]);
    });

    it("deduplicates repeated incoming connections and ignores stale endpoints", () => {
        const nodes = [node("source", CanvasNodeType.Text, { content: "Reference text" }), node("target", CanvasNodeType.Video)];
        const connections = [edge("source", "target"), edge("source", "target", "duplicate"), edge("gone", "target")];

        expect(getGenerationResourceNodes("target", nodes, connections)).toEqual([nodes[0]]);
        expect(getMentionResourceNodes("target", nodes, connections)).toEqual([nodes[0]]);
    });
});
