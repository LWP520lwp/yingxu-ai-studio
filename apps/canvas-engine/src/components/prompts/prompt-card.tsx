import { Copy, FileText } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "antd";
import { useTranslation } from "react-i18next";

import { formatPromptDate, type Prompt } from "@/services/api/prompts";

type PromptCardProps = {
  item: Prompt;
  onOpen: () => void;
  onCopy: () => void;
  actionLabel?: string;
  actionIcon?: ReactNode;
  actionType?: "text" | "primary";
  extraAction?: ReactNode;
  compact?: boolean;
};

export function PromptCard({
  item,
  onOpen,
  onCopy,
  actionLabel,
  actionIcon = <Copy className="size-3.5" aria-hidden="true" />,
  actionType = "text",
  extraAction,
  compact = false,
}: PromptCardProps) {
  const { i18n, t } = useTranslation();
  const title = item.title || t("common.untitled");

  return (
    <article
      className={
        compact
          ? "group min-w-0 overflow-hidden rounded-md border border-stone-200 bg-white transition-colors hover:border-stone-400 dark:border-stone-800 dark:bg-stone-950 dark:hover:border-stone-600"
          : "flex h-full min-w-0 flex-col overflow-hidden rounded-md border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950"
      }
    >
      <button
        type="button"
        className="block w-full overflow-hidden text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600"
        onClick={onOpen}
        aria-label={`${t("prompts.use")}: ${title}`}
      >
        {item.coverUrl ? (
          <img
            src={item.coverUrl}
            alt=""
            className={
              compact
                ? "aspect-square w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                : "aspect-[4/3] w-full object-cover"
            }
            loading="lazy"
          />
        ) : (
          <span
            className={`grid w-full place-items-center bg-stone-100 text-stone-400 dark:bg-stone-900 dark:text-stone-600 ${compact ? "aspect-square" : "aspect-[4/3]"}`}
          >
            <FileText className="size-8" aria-hidden="true" />
          </span>
        )}
      </button>

      <button
        type="button"
        className={`block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600 ${compact ? "px-3 py-2.5" : "flex-1 p-4"}`}
        onClick={onOpen}
        aria-label={`${t("prompts.use")}: ${title}`}
      >
        <span className="flex min-w-0 items-start justify-between gap-3">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-950 dark:text-stone-100">
            {title}
          </span>
          {!compact ? (
            <time
              className="shrink-0 text-xs text-stone-400 dark:text-stone-500"
              dateTime={item.updatedAt || undefined}
            >
              {formatPromptDate(item.updatedAt, i18n.resolvedLanguage)}
            </time>
          ) : null}
        </span>
        {!compact ? (
          <>
            <span className="mt-2 line-clamp-3 block text-xs leading-5 text-stone-600 dark:text-stone-400">
              {item.description || item.prompt}
            </span>
            {item.tags.length ? (
              <span className="mt-3 flex flex-wrap gap-1.5">
                {item.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded border border-stone-200 px-1.5 py-0.5 text-[11px] text-stone-600 dark:border-stone-700 dark:text-stone-300"
                  >
                    {tag}
                  </span>
                ))}
              </span>
            ) : null}
          </>
        ) : null}
      </button>

      {!compact ? (
        <footer className="mt-auto flex items-center gap-2 px-4 pb-4">
          <Button
            block={actionType === "primary"}
            type={actionType}
            size="small"
            icon={actionIcon}
            onClick={onCopy}
          >
            {actionLabel || t("common.copy")}
          </Button>
          {extraAction}
        </footer>
      ) : null}
    </article>
  );
}
