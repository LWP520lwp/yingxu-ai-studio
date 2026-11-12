import { App, Button, Empty, Input, Modal, Select, Tag } from "antd";
import { Copy, FolderPlus, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { PromptDetailDialog } from "@/pages/prompts/components/prompt-detail-dialog";
import { useCopyText } from "@/hooks/use-copy-text";
import { useAssetStore } from "@/stores/use-asset-store";
import {
  fetchSourcePrompts,
  refreshSource,
  type Prompt,
} from "@/services/api/prompts";
import type { PromptSource } from "@/services/api/prompt-source-presets";

export function PromptSourceContentModal({
  source,
  onClose,
}: {
  source: PromptSource | null;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const { t } = useTranslation();
  const [items, setItems] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Prompt | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const requestId = useRef(0);
  const mounted = useRef(true);
  const copyText = useCopyText();
  const addAsset = useAssetStore((state) => state.addAsset);
  const categories = useMemo(
    () => [...new Set(items.map((item) => item.category).filter(Boolean))],
    [items],
  );
  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return items.filter((item) => {
      if (category !== "all" && item.category !== category) return false;
      if (!normalized) return true;
      return [item.title, item.prompt, item.description, ...item.tags]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalized);
    });
  }, [category, items, query]);

  const load = useCallback(
    async (force: boolean) => {
      if (!source) return;
      const currentRequest = ++requestId.current;
      setLoading(true);
      try {
        const result = force
          ? await reloadPromptSource(source.id)
          : await fetchSourcePrompts(source.id);
        if (mounted.current && requestId.current === currentRequest) {
          setItems(result);
        }
      } catch (error) {
        if (mounted.current && requestId.current === currentRequest) {
          message.error(
            error instanceof Error
              ? error.message
              : t("config.promptSources.content.loadFailed"),
          );
        }
      } finally {
        if (mounted.current && requestId.current === currentRequest) {
          setLoading(false);
        }
      }
    },
    [message, source, t],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestId.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!source) {
      requestId.current += 1;
      setItems([]);
      setLoading(false);
      setDetail(null);
      return;
    }
    void load(false);
    return () => {
      requestId.current += 1;
    };
  }, [load, source?.id]);

  useEffect(() => {
    setQuery("");
    setCategory("all");
  }, [source?.id]);

  const saveAsset = useCallback(
    (item: Prompt) => {
      addAsset({
        kind: "text",
        title: item.title,
        coverUrl: item.coverUrl,
        tags: item.tags,
        source: item.category,
        data: { content: item.prompt },
        metadata: {
          source: "prompt-library",
          promptId: item.id,
          githubUrl: item.githubUrl,
        },
      });
      message.success(t("common.addedToAssets"));
    },
    [addAsset, message, t],
  );

  return (
    <>
      <Modal
        open={Boolean(source)}
        onCancel={onClose}
        width={980}
        footer={null}
        title={
          <div className="flex flex-wrap items-center justify-between gap-2 pr-6">
            <div>
              <div className="text-base font-semibold">
                {t("config.promptSources.content.title", {
                  name: source?.name || "",
                })}
              </div>
              <div className="mt-0.5 text-xs font-normal text-stone-500">
                {t("config.promptSources.content.count", {
                  count: items.length,
                })}
              </div>
            </div>
            <Button
              size="small"
              icon={<RefreshCw className="size-3.5" />}
              loading={loading}
              disabled={!source}
              onClick={() => void load(true)}
            >
              {t("config.promptSources.content.refresh")}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_220px]">
            <Input
              allowClear
              prefix={<Search className="size-3.5 text-stone-400" />}
              aria-label={t("config.promptSources.content.titleColumn")}
              placeholder={t("config.promptSources.content.titleColumn")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Select
              value={category}
              onChange={setCategory}
              aria-label={t("config.promptSources.content.tags")}
              options={[
                { value: "all", label: t("common.all") },
                ...categories.map((value) => ({ value, label: value })),
              ]}
            />
          </div>
          {visibleItems.length ? (
            <div className="grid max-h-[58vh] grid-cols-1 gap-2 overflow-y-auto pr-1 md:grid-cols-2">
              {visibleItems.map((item) => (
                <article
                  key={item.id}
                  className="grid min-w-0 grid-cols-[68px_minmax(0,1fr)] gap-3 rounded-md border border-stone-200 p-3 dark:border-stone-700"
                >
                  {item.coverUrl ? (
                    <img
                      src={item.coverUrl}
                      alt=""
                      loading="lazy"
                      className="size-[68px] rounded object-cover"
                    />
                  ) : (
                    <div className="grid size-[68px] place-items-center rounded bg-stone-100 text-xs text-stone-400 dark:bg-stone-800">
                      {item.category}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">
                      {item.title}
                    </div>
                    <p className="mt-1 line-clamp-3 break-words text-xs leading-5 text-stone-500">
                      {item.prompt}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {item.tags.slice(0, 4).map((tag, index) => (
                        <Tag key={`${tag}:${index}`} className="m-0">
                          {tag}
                        </Tag>
                      ))}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Button
                        size="small"
                        type="text"
                        icon={<Copy className="size-3.5" />}
                        onClick={() =>
                          void copyText(item.prompt, t("common.promptCopied"))
                        }
                      >
                        {t("common.copy")}
                      </Button>
                      <Button
                        size="small"
                        type="text"
                        onClick={() => setDetail(item)}
                      >
                        {t("common.details")}
                      </Button>
                      <Button
                        size="small"
                        type="text"
                        icon={<FolderPlus className="size-3.5" />}
                        onClick={() => saveAsset(item)}
                      >
                        {t("common.addToAssets")}
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("config.promptSources.content.empty")}
              className="py-12"
            />
          )}
        </div>
      </Modal>
      <PromptDetailDialog
        prompt={detail}
        onClose={() => setDetail(null)}
        onCopy={(prompt) => copyText(prompt, t("common.promptCopied"))}
        onSaveAsset={saveAsset}
      />
    </>
  );
}

async function reloadPromptSource(sourceId: string) {
  await refreshSource(sourceId);
  return fetchSourcePrompts(sourceId);
}
