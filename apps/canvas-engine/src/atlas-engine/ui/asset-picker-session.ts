import {
  clampAssetPickerPage,
  filterPickerAssets,
  getAssetPickerPage,
  type AssetPickerKindFilter,
} from "./asset-picker";
import type { Asset } from "@/stores/use-asset-store";

export type AssetPickerQuery = Readonly<{
  kind: AssetPickerKindFilter;
  text: string;
  page: number;
}>;

export type AssetPickerQueryAction =
  | { type: "search"; text: string }
  | { type: "filter-kind"; kind: AssetPickerKindFilter }
  | { type: "change-page"; page: number }
  | { type: "restore-kind"; kind: AssetPickerKindFilter }
  | { type: "reconcile-results"; resultCount: number };

export type AssetPickerPage = Readonly<{
  matches: Asset[];
  items: Asset[];
  page: number;
}>;

export function createAssetPickerQuery(
  kind: AssetPickerKindFilter,
): AssetPickerQuery {
  return { kind, text: "", page: 1 };
}

export function transitionAssetPickerQuery(
  query: AssetPickerQuery,
  action: AssetPickerQueryAction,
): AssetPickerQuery {
  switch (action.type) {
    case "search":
      return query.text === action.text
        ? query
        : { ...query, text: action.text, page: 1 };
    case "filter-kind":
      return query.kind === action.kind
        ? query
        : { ...query, kind: action.kind, page: 1 };
    case "change-page":
      return { ...query, page: Math.max(1, Math.floor(action.page || 1)) };
    case "restore-kind":
      return query.kind === action.kind && query.page === 1
        ? query
        : { ...query, kind: action.kind, page: 1 };
    case "reconcile-results":
      return {
        ...query,
        page: clampAssetPickerPage(query.page, action.resultCount),
      };
  }
}

export function deriveAssetPickerPage(
  assets: readonly Asset[],
  query: AssetPickerQuery,
): AssetPickerPage {
  const matches = filterPickerAssets(assets, query.kind, query.text);
  const page = clampAssetPickerPage(query.page, matches.length);
  return {
    matches,
    page,
    items: getAssetPickerPage(matches, page),
  };
}
