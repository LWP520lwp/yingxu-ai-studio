import { Button, Modal, Space, Tag } from "antd";
import { Copy, FileText, FolderPlus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { formatPromptDate, type Prompt } from "@/services/api/prompts";

export function PromptDetailDialog({
  prompt,
  onClose,
  onCopy,
  onSaveAsset,
}: {
  prompt: Prompt | null;
  onClose: () => void;
  onCopy: (prompt: string) => void;
  onSaveAsset?: (prompt: Prompt) => void;
}) {
  const { i18n, t } = useTranslation();

  return (
    <Modal
      title={prompt?.title}
      open={Boolean(prompt)}
      onCancel={onClose}
      footer={null}
      width={720}
      centered
      styles={{ body: { height: "calc(85vh - 55px)", overflow: "hidden" } }}
    >
      {prompt ? (
        <article className="flex h-full min-h-0 flex-col">
          <PromptArtwork prompt={prompt} />
          <PromptDescription
            prompt={prompt}
            locale={i18n.resolvedLanguage}
            translate={t}
          />
          <div className="shrink-0 pt-4">
            <Space wrap>
              <Button
                type="primary"
                icon={<Copy className="size-4" />}
                onClick={() => onCopy(prompt.prompt)}
              >
                {t("common.copyPrompt")}
              </Button>
              {onSaveAsset ? (
                <Button
                  icon={<FolderPlus className="size-4" />}
                  onClick={() => onSaveAsset(prompt)}
                >
                  {t("common.addToAssets")}
                </Button>
              ) : null}
            </Space>
          </div>
        </article>
      ) : null}
    </Modal>
  );
}

function PromptArtwork({ prompt }: { prompt: Prompt }) {
  const references = (prompt.referenceImageUrls || []).filter(
    (url, index, all) =>
      url && url !== prompt.coverUrl && all.indexOf(url) === index,
  );

  return (
    <header className="shrink-0 space-y-3 pb-4">
      {prompt.coverUrl ? (
        <img
          src={prompt.coverUrl}
          alt={prompt.title}
          className="h-48 w-full rounded-lg object-cover sm:h-56"
        />
      ) : (
        <div
          className="grid h-48 w-full place-items-center rounded-lg bg-stone-100 text-stone-400 dark:bg-stone-900 dark:text-stone-600 sm:h-56"
          aria-label={prompt.title}
        >
          <FileText className="size-9" aria-hidden="true" />
        </div>
      )}
      {references.length > 1 ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {references.slice(0, 6).map((url) => (
            <img
              key={url}
              src={url}
              alt=""
              className="aspect-square w-full rounded-md object-cover"
              loading="lazy"
            />
          ))}
        </div>
      ) : null}
    </header>
  );
}

function PromptDescription({
  prompt,
  locale,
  translate,
}: {
  prompt: Prompt;
  locale?: string;
  translate: (key: string, options?: Record<string, unknown>) => string;
}) {
  const tags = prompt.tags || [];
  const createdAt = prompt.createdAt
    ? formatPromptDate(prompt.createdAt, locale)
    : "";
  const updatedAt = prompt.updatedAt
    ? formatPromptDate(prompt.updatedAt, locale)
    : "";

  return (
    <section className="min-h-0 min-w-0 flex-1 overflow-y-auto border-y border-stone-200 py-4 pr-2 dark:border-stone-800">
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag, index) => (
          <Tag key={`${tag}:${index}`} className="m-0">
            {tag}
          </Tag>
        ))}
      </div>
      {prompt.description ? (
        <p className="mt-4 text-sm leading-6 text-stone-500 dark:text-stone-400">
          {prompt.description}
        </p>
      ) : null}
      {prompt.preview ? (
        <pre className="mt-4 whitespace-pre-wrap rounded-lg bg-stone-100 p-3 text-xs leading-5 text-stone-600 dark:bg-stone-900 dark:text-stone-300">
          {prompt.preview}
        </pre>
      ) : null}
      <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-stone-800 dark:text-stone-300">
        {prompt.prompt}
      </p>
      {createdAt || updatedAt ? (
        <div className="mt-4 text-xs text-stone-500 dark:text-stone-400">
          {createdAt ? translate("common.created", { date: createdAt }) : null}
          {createdAt && updatedAt ? " · " : null}
          {updatedAt ? translate("common.updated", { date: updatedAt }) : null}
        </div>
      ) : null}
    </section>
  );
}
