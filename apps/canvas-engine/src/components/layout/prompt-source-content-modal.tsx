import { App, Button, Empty, Modal, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Copy, FolderPlus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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

type PromptColumnFactory = (actions: {
  copy: (text: string) => void;
  details: (prompt: Prompt) => void;
  save: (prompt: Prompt) => void;
  labels: {
    cover: string;
    title: string;
    tags: string;
    actions: string;
    copy: string;
    details: string;
    save: string;
  };
}) => ColumnsType<Prompt>;

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
  const requestId = useRef(0);
  const mounted = useRef(true);
  const copyText = useCopyText();
  const addAsset = useAssetStore((state) => state.addAsset);

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

  const columns = buildPromptColumns({
    copy: (text) => copyText(text, t("common.promptCopied")),
    details: setDetail,
    save: saveAsset,
    labels: {
      cover: t("config.promptSources.content.cover"),
      title: t("config.promptSources.content.titleColumn"),
      tags: t("config.promptSources.content.tags"),
      actions: t("config.promptSources.content.actions"),
      copy: t("common.copy"),
      details: t("common.details"),
      save: t("common.addToAssets"),
    },
  });

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
        <Table<Prompt>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={items}
          pagination={{ pageSize: 10, showSizeChanger: false, size: "small" }}
          scroll={{ y: "56vh" }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t("config.promptSources.content.empty")}
              />
            ),
          }}
          columns={columns}
        />
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

const buildPromptColumns: PromptColumnFactory = ({
  copy,
  details,
  save,
  labels,
}) => [
  {
    title: labels.cover,
    dataIndex: "coverUrl",
    width: 72,
    render: (coverUrl: string) =>
      coverUrl ? (
        <img
          src={coverUrl}
          alt=""
          loading="lazy"
          className="size-12 rounded object-cover"
        />
      ) : (
        <div className="size-12 rounded bg-stone-100 dark:bg-stone-800" />
      ),
  },
  {
    title: labels.title,
    dataIndex: "title",
    render: (title: string, item: Prompt) => (
      <div className="min-w-0">
        <div className="truncate font-medium">{title}</div>
        <div className="mt-0.5 line-clamp-2 text-xs text-stone-500">
          {item.prompt}
        </div>
      </div>
    ),
  },
  {
    title: labels.tags,
    dataIndex: "tags",
    width: 200,
    render: (tags: string[]) => (
      <div className="flex flex-wrap gap-1">
        {tags.slice(0, 4).map((tag, index) => (
          <Tag key={`${tag}:${index}`} className="m-0">
            {tag}
          </Tag>
        ))}
      </div>
    ),
  },
  {
    title: labels.actions,
    width: 210,
    render: (_: unknown, item: Prompt) => (
      <Space size={4} wrap>
        <Button
          size="small"
          type="text"
          icon={<Copy className="size-3.5" />}
          onClick={() => copy(item.prompt)}
        >
          {labels.copy}
        </Button>
        <Button size="small" type="text" onClick={() => details(item)}>
          {labels.details}
        </Button>
        <Button
          size="small"
          type="text"
          icon={<FolderPlus className="size-3.5" />}
          onClick={() => save(item)}
        >
          {labels.save}
        </Button>
      </Space>
    ),
  },
];

async function reloadPromptSource(sourceId: string) {
  await refreshSource(sourceId);
  return fetchSourcePrompts(sourceId);
}
