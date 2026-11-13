import type { CanvasNodeData, CanvasNodeStatus } from "@/types/canvas";

export const NODE_DRAFT_KINDS = [
  "text",
  "image",
  "video",
  "audio",
  "config",
  "group",
  "extension",
] as const;
export type NodeDraftKind = (typeof NODE_DRAFT_KINDS)[number];
export type NodeDraftItem = {
  id: string;
  title: string;
  type: string;
  kind: NodeDraftKind;
  status: CanvasNodeStatus;
  summary: string;
  model: string;
  childCount: number;
  searchText: string;
};
export type NodeDraftFilter = {
  query?: string;
  kind?: NodeDraftKind | "all";
  status?: CanvasNodeStatus | "all";
};

const KNOWN_KINDS = new Set<string>(NODE_DRAFT_KINDS);
const STATUS_PRIORITY: readonly CanvasNodeStatus[] = [
  "loading",
  "error",
  "success",
  "idle",
];

function textValue(value: string | undefined): string {
  if (!value || /^\s*(?:data:|blob:|https?:\/\/|file:)/i.test(value)) return "";
  return value.slice(0, 16_000).replace(/\s+/g, " ").trim();
}

function nodeStatus(node: CanvasNodeData): CanvasNodeStatus {
  const metadata = node.metadata;
  if (metadata?.status && metadata.status !== "idle") return metadata.status;
  const statuses = [
    ...(metadata?.texts ?? []).map((item) => item.status),
    ...(metadata?.images ?? []).map((item) => item.status),
  ];
  return STATUS_PRIORITY.find((status) => statuses.includes(status)) ?? "idle";
}

/** Drafts are a live document projection, including unfinished and extension nodes. */
export function projectNodeDrafts(
  nodes: readonly CanvasNodeData[],
): NodeDraftItem[] {
  const childCounts = new Map<string, number>();
  for (const node of nodes) {
    const groupId = node.metadata?.groupId;
    if (groupId) childCounts.set(groupId, (childCounts.get(groupId) ?? 0) + 1);
  }
  return nodes.map((node) => {
    const metadata = node.metadata;
    const kind = KNOWN_KINDS.has(node.type)
      ? (node.type as NodeDraftKind)
      : "extension";
    const values = [
      ...(kind === "text" ? [metadata?.content] : []),
      metadata?.composerContent,
      metadata?.prompt,
      ...(kind === "config" || kind === "extension" ? [metadata?.content] : []),
      ...(metadata?.texts ?? []).slice(0, 20).map((item) => item.content),
    ]
      .map(textValue)
      .filter(Boolean);
    const model = textValue(metadata?.model);
    return {
      id: node.id,
      title: node.title.trim(),
      type: node.type,
      kind,
      status: nodeStatus(node),
      summary: (values[0] ?? "").slice(0, 160),
      model,
      childCount: childCounts.get(node.id) ?? 0,
      searchText: [node.id, node.title, node.type, model, ...values]
        .join(" ")
        .toLocaleLowerCase(),
    };
  });
}

export function filterNodeDrafts(
  items: readonly NodeDraftItem[],
  { query = "", kind = "all", status = "all" }: NodeDraftFilter,
): NodeDraftItem[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(
    (item) =>
      (kind === "all" || item.kind === kind) &&
      (status === "all" || item.status === status) &&
      terms.every((term) => item.searchText.includes(term)),
  );
}
