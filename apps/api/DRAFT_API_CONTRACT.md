# Independent draft libraries

Canvas and science drafts are independent native snapshots. A project can contain either or both; opening/saving one never replaces the other. Existing snapshots remain visible without copying their document JSON into a new drafts table.

All routes require the current authenticated user. Responses use `Cache-Control: no-store`. Mutations use the existing same-origin `X-Workbench-Request: 1` guard.

## GET `/api/drafts`

Query parameters:

- `kind`: required `canvas` or `science`.
- `q`: optional literal title search, at most 120 characters. `%` and `_` do not act as wildcard operators.
- `limit`: optional 1–60, default 24.
- `cursor`: opaque `nextCursor` from the preceding page; reset it when `kind` or `q` changes.

Response:

```json
{
  "items": [
    {
      "projectId": "uuid",
      "kind": "science",
      "title": "月球为什么总是这一面",
      "revision": 3,
      "updatedAt": "2026-11-10T10:39:55.123Z",
      "itemCount": 2
    }
  ],
  "nextCursor": null
}
```

`itemCount` means canvas nodes or science scenes. Each native document's nonblank `title` takes precedence over the legacy project title; the latter is only a fallback for old snapshots. `updatedAt` is the corresponding native snapshot clock, not an unrelated edit in the other module. Results use `updatedAt DESC, projectId DESC` keyset pagination, scoped to the owner. Lists do not return document JSON, sources, media URLs, or credentials. Pagination is a live list; refreshing the first page incorporates edits made during paging.

## POST `/api/drafts`

```json
{ "kind": "canvas", "title": "新的画布" }
```

`title` may be omitted or blank for the corresponding default name; at most 200 characters. The service atomically creates the project, legacy revision, and only the selected native snapshot. It returns HTTP 201 and one summary in the same shape as a list item, with `revision: 1` and `itemCount: 0`.

Open the returned `projectId` through the existing project API, then use `/api/projects/{id}/canvas-engine` or `/api/projects/{id}/science` for its editable document. Both retain their existing independent revision conflict checks.

## PATCH `/api/drafts/{projectId}`

```json
{ "kind": "canvas", "title": "月球探索画布", "baseRevision": 3 }
```

Renames a card without opening its editor. `kind` is required, `title` must contain 1–200 characters after trimming and no control characters, and `baseRevision` must be the positive native revision shown on that card. The response is HTTP 200 with the updated `DraftSummary`; its native `revision` increments once and `updatedAt` advances. Every accepted patch increments the revision, including an identical title.

The transaction verifies ownership, locks the owning project and chosen snapshot in the same order as native editors, and uses `JSON_SET` to change only that snapshot's `$.title`. It never accepts/replaces document JSON, changes the shared legacy project title/revision, creates a missing native snapshot, or alters the other module. Nodes, connections, chat sessions, sources and scenes remain intact. Foreign projects and a missing selected snapshot both return HTTP 404. A stale `baseRevision` returns HTTP 409:

```json
{ "code": "DRAFT_REVISION_CONFLICT", "message": "草稿已更新，请刷新列表后重新命名", "kind": "canvas", "currentRevision": 4 }
```

An already-open editor retaining the old revision must reconcile its native snapshot before saving; it cannot overwrite the renamed document using the old revision. The canvas host must use the loaded native title during initialization, rather than enqueue the older legacy project title as a rename command. The frontend refreshes the scoped library after a rename or conflict; the Radix dialog retains failed input and requires reopening from the latest card after a revision conflict.

## Verification

`DraftServiceTest` runs against MySQL and rolls back fixtures. It verifies separated native documents and owners, independent title/count summaries, equal-timestamp keyset paging without duplicates, literal wildcard searches, invalid/bounded inputs, isolated rename updates, preservation of both documents and legacy revision, stale rename/editor-save rejection, foreign access and missing-kind rejection. The frontend `draftLibraryModel.test.ts` verifies page replacement/deduplication, rename isolation by module, search reconciliation, newer-revision protection and title validation.
