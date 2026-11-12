import { ALL_PROMPTS_OPTION } from "@/services/api/prompts";

export type PromptPageMetrics = {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
};

export function normalizePromptTags(
  tags: readonly string[],
  allOption = ALL_PROMPTS_OPTION,
): string[] {
  return [...new Set(tags.filter((tag) => tag && tag !== allOption))].sort();
}

export function togglePromptTag(
  current: readonly string[],
  tag: string,
  allOption = ALL_PROMPTS_OPTION,
): string[] {
  if (tag === allOption) return [];
  return current.includes(tag)
    ? current.filter((item) => item !== tag)
    : normalizePromptTags([...current, tag], allOption);
}

export function isPromptTagSelected(
  current: readonly string[],
  tag: string,
  allOption = ALL_PROMPTS_OPTION,
): boolean {
  return tag === allOption ? current.length === 0 : current.includes(tag);
}

export function getNextPromptPage<
  Page extends { items: readonly unknown[]; total: number },
>(lastPage: Page, pages: readonly Page[]): number | undefined {
  const loaded = pages.reduce((total, page) => total + page.items.length, 0);
  return loaded < Math.max(0, lastPage.total) ? pages.length + 1 : undefined;
}

export function flattenPromptPages<
  Item,
  Page extends { items: readonly Item[] },
>(pages: readonly Page[] | undefined): Item[] {
  return pages?.flatMap((page) => page.items) ?? [];
}

export function shouldLoadNextPromptPage(
  metrics: PromptPageMetrics,
  hasNextPage: boolean,
  isFetchingNextPage: boolean,
  threshold = 160,
): boolean {
  if (!hasNextPage || isFetchingNextPage) return false;
  const distanceToEnd =
    metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
  return (
    Number.isFinite(distanceToEnd) && distanceToEnd <= Math.max(0, threshold)
  );
}
