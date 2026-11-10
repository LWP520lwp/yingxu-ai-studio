export type DraftKind = "canvas" | "science";
export type DraftSummary = {
  projectId: string;
  kind: DraftKind;
  title: string;
  revision: number;
  updatedAt: string;
  itemCount: number;
};
export type DraftPage = { items: DraftSummary[]; nextCursor: string | null };

export function draftTitleError(value: string): string {
  const title = value.trim();
  if (!title) return "请输入草稿名称。";
  if (title.length > 200 || /[\u0000-\u001f\u007f-\u009f]/u.test(title)) return "名称最多200字符，且不能包含换行或控制字符。";
  return "";
}

/** A rename response may affect only its own module and must never regress a newer local result. */
export function applyDraftRename(current: readonly DraftSummary[], renamed: DraftSummary, query = ""): DraftSummary[] {
  const search = query.trim().toLocaleLowerCase();
  return current.flatMap((known) => {
    if (known.projectId !== renamed.projectId || known.kind !== renamed.kind || known.revision > renamed.revision) return [known];
    return !search || renamed.title.toLocaleLowerCase().includes(search) ? [renamed] : [];
  }).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || b.projectId.localeCompare(a.projectId));
}

/** Refreshed first pages replace the list; later pages cannot duplicate a recently edited draft. */
export function mergeDraftPage(current: readonly DraftSummary[], page: DraftPage, append: boolean): DraftSummary[] {
  if (!append) return page.items;
  const drafts = new Map(current.map((draft) => [draft.projectId, draft]));
  for (const draft of page.items) {
    const known = drafts.get(draft.projectId);
    if (!known || Date.parse(draft.updatedAt) > Date.parse(known.updatedAt)) drafts.set(draft.projectId, draft);
  }
  return [...drafts.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || b.projectId.localeCompare(a.projectId));
}
