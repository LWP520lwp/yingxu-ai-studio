import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";

import {
  flattenPromptPages,
  getNextPromptPage,
  normalizePromptTags,
} from "@/lib/prompt-picker";
import {
  ALL_PROMPTS_OPTION,
  fetchPrompts,
  type Prompt,
  type PromptListResponse,
} from "@/services/api/prompts";

export const PROMPT_PAGE_SIZE = 20;
export const PROMPT_SEARCH_DEBOUNCE_MS = 300;

type UsePromptListOptions = {
  keyword: string;
  tags: string[];
  category: string;
  enabled?: boolean;
};

export function usePromptList({
  keyword,
  tags,
  category,
  enabled = true,
}: UsePromptListOptions) {
  const [debouncedKeyword, setDebouncedKeyword] = useState(keyword);
  const normalizedTags = useMemo(() => normalizePromptTags(tags), [tags]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedKeyword(keyword),
      PROMPT_SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [keyword]);

  const query = useInfiniteQuery({
    queryKey: ["prompts", debouncedKeyword.trim(), normalizedTags, category],
    queryFn: ({ pageParam }) =>
      fetchPrompts({
        keyword: debouncedKeyword,
        tag: normalizedTags,
        category,
        page: pageParam,
        pageSize: PROMPT_PAGE_SIZE,
      }),
    initialPageParam: 1,
    getNextPageParam: getNextPromptPage,
    enabled,
  });

  const pages = query.data?.pages;
  const firstPage = pages?.[0];
  const items = useMemo(
    () => flattenPromptPages<Prompt, PromptListResponse>(pages),
    [pages],
  );
  const availableTags = useMemo(
    () => [ALL_PROMPTS_OPTION, ...(firstPage?.tags ?? [])],
    [firstPage?.tags],
  );
  const categories = useMemo(
    () => [ALL_PROMPTS_OPTION, ...(firstPage?.categories ?? [])],
    [firstPage?.categories],
  );

  return {
    query,
    items,
    tags: availableTags,
    categories,
    total: firstPage?.total ?? 0,
  };
}
