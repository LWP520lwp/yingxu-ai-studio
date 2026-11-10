import type { CanvasDocument, CreativeNode } from "./types";

export function canvasInputs(document: CanvasDocument, targetId: string) {
  const target = document.nodes.find((node) => node.id === targetId);
  const ids = new Set([
    ...document.edges.filter((edge) => edge.target === targetId).map((edge) => edge.source),
    ...(target?.data.sourceNodeIds || []),
  ]);
  const sources = [...ids].map((id) => document.nodes.find((node) => node.id === id))
    .filter((node): node is CreativeNode => !!node);
  return {
    sources,
    notes: sources.filter((node) => node.data.kind === "note").map((node) => node.data.prompt.trim()).filter(Boolean),
    imageIds: [...new Set(sources.filter((node) => node.data.kind === "image" && node.data.assetId).map((node) => node.data.assetId!))],
    pendingImages: sources.filter((node) => node.data.kind === "image" && !node.data.assetId).length,
    videos: sources.filter((node) => node.data.kind === "video").length,
  };
}

export function assembledPrompt(notes: string[], prompt: string) {
  return [...notes, prompt].map((text) => text.trim()).filter(Boolean).join("\n\n");
}
