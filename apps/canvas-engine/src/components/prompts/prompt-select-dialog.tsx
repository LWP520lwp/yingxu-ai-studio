import { useEffect, useRef, useState, type UIEvent } from "react";
import { Alert, Button, Empty, Input, Modal, Spin } from "antd";
import { RefreshCw, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  isPromptTagSelected,
  shouldLoadNextPromptPage,
  togglePromptTag,
} from "@/lib/prompt-picker";
import { ALL_PROMPTS_OPTION } from "@/services/api/prompts";
import { PromptCard } from "./prompt-card";
import { usePromptList } from "./use-prompt-list";

type PromptSelectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (prompt: string) => void;
};

export function PromptSelectDialog({
  open,
  onOpenChange,
  onSelect,
}: PromptSelectDialogProps) {
  const { t } = useTranslation();
  const [keyword, setKeyword] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState(ALL_PROMPTS_OPTION);
  const listRef = useRef<HTMLDivElement>(null);
  const { query, items, tags, categories, total } = usePromptList({
    keyword,
    tags: selectedTags,
    category: selectedCategory,
    enabled: open,
  });

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [keyword, selectedTags, selectedCategory, open]);

  const choosePrompt = (prompt: string) => {
    try {
      onSelect(prompt);
    } finally {
      onOpenChange(false);
    }
  };

  const handleListScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    if (
      shouldLoadNextPromptPage(
        {
          scrollTop: target.scrollTop,
          clientHeight: target.clientHeight,
          scrollHeight: target.scrollHeight,
        },
        Boolean(query.hasNextPage),
        query.isFetchingNextPage,
      )
    ) {
      void query.fetchNextPage();
    }
  };

  return (
    <Modal
      title={t("prompts.library")}
      open={open}
      onCancel={() => onOpenChange(false)}
      footer={null}
      width="min(1040px, calc(100vw - 24px))"
      centered
      styles={{ body: { padding: "20px 24px 24px" } }}
    >
      <div
        className="grid h-[min(68dvh,720px)] min-h-[320px] gap-5 sm:grid-cols-[190px_minmax(0,1fr)]"
        data-canvas-no-zoom
        onWheelCapture={(event) => event.stopPropagation()}
      >
        <aside className="thin-scrollbar min-h-0 overflow-y-auto sm:border-r sm:border-stone-200 sm:pr-4 dark:sm:border-stone-800">
          <FilterGroup label={t("prompts.category")}>
            {categories.map((category) => (
              <FilterButton
                key={category}
                active={selectedCategory === category}
                onClick={() => setSelectedCategory(category)}
              >
                {category === ALL_PROMPTS_OPTION ? t("common.all") : category}
              </FilterButton>
            ))}
          </FilterGroup>

          <FilterGroup label={t("prompts.tags")} className="mt-4">
            {tags.map((tag) => (
              <FilterButton
                key={tag}
                active={isPromptTagSelected(selectedTags, tag)}
                onClick={() =>
                  setSelectedTags((current) => togglePromptTag(current, tag))
                }
              >
                {tag === ALL_PROMPTS_OPTION ? t("common.all") : tag}
              </FilterButton>
            ))}
          </FilterGroup>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Input
              className="min-w-[180px] flex-1"
              size="large"
              prefix={
                <Search className="size-4 text-stone-400" aria-hidden="true" />
              }
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={t("prompts.searchTitle")}
              aria-label={t("prompts.search")}
              allowClear
            />
            <span
              className="text-xs tabular-nums text-stone-500 dark:text-stone-400"
              aria-live="polite"
            >
              {t("prompts.total", { count: total })}
            </span>
          </div>

          {query.isError ? (
            <Alert
              className="mt-3"
              type="error"
              showIcon
              role="alert"
              message={
                query.error instanceof Error
                  ? query.error.message
                  : t("prompts.loadFailed")
              }
              action={
                <Button
                  type="text"
                  size="small"
                  icon={<RefreshCw className="size-3.5" aria-hidden="true" />}
                  loading={query.isFetching}
                  onClick={() => void query.refetch()}
                >
                  {t("generation.retry")}
                </Button>
              }
            />
          ) : null}

          <div
            ref={listRef}
            className="thin-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto pr-2"
            data-canvas-no-zoom
            onScroll={handleListScroll}
            onWheelCapture={(event) => event.stopPropagation()}
            aria-busy={query.isLoading || query.isFetchingNextPage}
          >
            {query.isLoading && !items.length ? (
              <div
                className="flex h-40 items-center justify-center gap-2 text-sm text-stone-500"
                role="status"
              >
                <Spin size="small" />
                <span>{t("prompts.loading")}</span>
              </div>
            ) : null}

            {items.length ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {items.map((item) => (
                  <PromptCard
                    key={`${item.sourceId}:${item.id}`}
                    item={item}
                    onOpen={() => choosePrompt(item.prompt)}
                    onCopy={() => choosePrompt(item.prompt)}
                    compact
                  />
                ))}
              </div>
            ) : null}

            {!query.isLoading && !query.isError && items.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t("prompts.empty")}
                className="py-8"
              />
            ) : null}

            {query.isFetchingNextPage ? (
              <div
                className="flex items-center justify-center gap-2 py-4 text-xs text-stone-500"
                role="status"
              >
                <Spin size="small" />
                <span>{t("prompts.loading")}</span>
              </div>
            ) : null}

            {!query.isLoading &&
            !query.isFetchingNextPage &&
            items.length > 0 &&
            !query.hasNextPage ? (
              <p className="py-4 text-center text-xs text-stone-400 dark:text-stone-500">
                {t("prompts.end")}
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </Modal>
  );
}

function FilterGroup({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <h2 className="mb-2 text-xs font-semibold text-stone-500 dark:text-stone-400">
        {label}
      </h2>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-8 max-w-full rounded-md border px-2.5 py-1 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${active ? "border-emerald-700 bg-emerald-50 font-medium text-emerald-900 dark:border-emerald-400 dark:bg-emerald-950/50 dark:text-emerald-100" : "border-stone-200 text-stone-600 hover:border-stone-400 dark:border-stone-700 dark:text-stone-300 dark:hover:border-stone-500"}`}
    >
      <span className="block truncate">{children}</span>
    </button>
  );
}
