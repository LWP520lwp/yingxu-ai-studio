import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, json, message } from "./api";
import { applyDraftRename, draftTitleError, mergeDraftPage, type DraftKind, type DraftPage, type DraftSummary } from "./draftLibraryModel";

type LibraryState = {
  key: string;
  items: DraftSummary[];
  nextCursor: string | null;
  loading: boolean;
  error: string;
};
const empty = (key: string): LibraryState => ({ key, items: [], nextCursor: null, loading: false, error: "" });

/** Visible draft pages are scoped to the user, module and search, including before effect cleanup. */
export function useDraftLibrary(userId: string | undefined, active: boolean) {
  const [kind, setKind] = useState<DraftKind>("canvas");
  const [query, setQuery] = useState("");
  const [state, setState] = useState<LibraryState>(() => empty(""));
  const key = JSON.stringify([userId || "", kind, query]);
  const context = useRef({ userId, active, kind, query, key });
  context.current = { userId, active, kind, query, key };
  const snapshot = useRef(state);
  const mounted = useRef(true);
  const sequence = useRef(0);
  const request = useRef<{ sequence: number; controller: AbortController } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = useCallback((next: LibraryState) => {
    snapshot.current = next;
    setState(next);
  }, []);
  const cancel = useCallback(() => {
    sequence.current += 1;
    request.current?.controller.abort();
    request.current = null;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const fetchPage = useCallback(async (append: boolean, preserve = false): Promise<void> => {
    const scope = context.current;
    if (!mounted.current || !scope.userId || !scope.active) return;
    if (append && (request.current || timer.current !== null)) return;
    const previous = snapshot.current.key === scope.key ? snapshot.current : empty(scope.key);
    // The same control also retries a failed first page, which has no cursor yet.
    if (append && !previous.nextCursor && !previous.error) return;
    const appending = append && Boolean(previous.nextCursor);
    if (!appending) cancel();
    const controller = new AbortController();
    const requestSequence = ++sequence.current;
    request.current = { sequence: requestSequence, controller };
    const pending: LibraryState = {
      key: scope.key, items: appending || preserve ? previous.items : [],
      nextCursor: appending ? previous.nextCursor : null, loading: true, error: "",
    };
    update(pending);
    const current = () => mounted.current && context.current.active && context.current.key === scope.key
      && sequence.current === requestSequence && !controller.signal.aborted;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]);
    const parameters = new URLSearchParams({ kind: scope.kind, limit: "24" });
    if (scope.query.trim()) parameters.set("q", scope.query.trim());
    if (appending && previous.nextCursor) parameters.set("cursor", previous.nextCursor);
    try {
      const page = await api<DraftPage>(`/drafts?${parameters}`, { signal });
      if (!current()) return;
      update({ key: scope.key, items: mergeDraftPage(previous.items, page, appending), nextCursor: page.nextCursor, loading: false, error: "" });
    } catch (error) {
      if (current()) update({ ...pending, loading: false, error: signal.aborted ? "草稿加载超时，请重试。" : message(error) });
    } finally {
      if (request.current?.sequence === requestSequence) request.current = null;
    }
  }, [cancel, update]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancel(); };
  }, [cancel]);

  useEffect(() => {
    cancel();
    const scope = context.current;
    if (!userId) {
      setKind("canvas"); setQuery("");
      update(empty(scope.key));
      return;
    }
    if (!active) {
      update(snapshot.current.key === scope.key ? { ...snapshot.current, loading: false, error: "" } : empty(scope.key));
      return;
    }
    update({ ...empty(scope.key), loading: true });
    timer.current = setTimeout(() => {
      timer.current = null;
      void fetchPage(false);
    }, 250);
    return cancel;
  }, [userId, active, kind, query, cancel, fetchPage, update]);

  const refresh = useCallback(() => fetchPage(false), [fetchPage]);
  const loadMore = useCallback(() => fetchPage(true), [fetchPage]);
  const rename = useCallback(async (draft: DraftSummary, requestedTitle: string): Promise<DraftSummary> => {
    const scope = context.current;
    if (!scope.userId || !scope.active || draft.kind !== scope.kind) throw new Error("请在当前草稿库重新打开重命名。");
    const invalid = draftTitleError(requestedTitle);
    if (invalid) throw new Error(invalid);
    try {
      const renamed = await api<DraftSummary>(`/drafts/${encodeURIComponent(draft.projectId)}`, {
        method: "PATCH", body: json({ kind: draft.kind, title: requestedTitle.trim(), baseRevision: draft.revision }),
      });
      if (!mounted.current || context.current.userId !== scope.userId) throw new Error("登录用户已切换，请在原账号中查看草稿名称。");
      if (context.current.active && context.current.key === scope.key) {
        cancel();
        const known = snapshot.current.key === scope.key ? snapshot.current : empty(scope.key);
        update({ ...known, items: applyDraftRename(known.items, renamed, scope.query), loading: false, error: "" });
        // Revalidate title search and keyset paging without blanking the card grid.
        void fetchPage(false, true);
      }
      return renamed;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && mounted.current && context.current.active && context.current.key === scope.key)
        void fetchPage(false, true);
      throw error;
    }
  }, [cancel, fetchPage, update]);
  // A new account/filter never renders the prior scope's data while cleanup is queued.
  const visible = userId && state.key === key ? state : { ...empty(key), loading: Boolean(userId && active) };
  return {
    kind, setKind, query, setQuery, items: visible.items,
    loading: visible.loading, error: visible.error, hasMore: Boolean(visible.nextCursor),
    loadMore, refresh, rename,
  };
}
