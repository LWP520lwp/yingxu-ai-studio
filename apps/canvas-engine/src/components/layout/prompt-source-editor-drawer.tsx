import { App, Button, Drawer, Input, Space, Switch } from "antd";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  createPromptSource,
  type PromptSource,
} from "@/services/api/prompt-source-presets";

type PromptSourceValidation =
  | { valid: true; value: PromptSource }
  | { valid: false; reason: "name" | "url" | "homepage" };

export function validatePromptSourceDraft(
  draft: PromptSource,
): PromptSourceValidation {
  const value = createPromptSource(draft);
  if (!value.name) return { valid: false, reason: "name" };
  if (!isHttpUrl(value.url)) return { valid: false, reason: "url" };
  if (value.homepage && !isHttpUrl(value.homepage)) {
    return { valid: false, reason: "homepage" };
  }
  return {
    valid: true,
    value: { ...value, builtIn: false },
  };
}

export function isHttpUrl(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

const FORMAT_EXAMPLE = `[
  {
    "id": "product-photo-1",
    "title": "Product photo",
    "prompt": "Generate a professional product photo on a white background",
    "description": "",
    "coverUrl": "",
    "referenceImageUrls": [],
    "tags": ["product", "photography"]
  }
]`;

export function PromptSourceEditorDrawer({
  open,
  source,
  onSave,
  onClose,
}: {
  open: boolean;
  source: PromptSource | null;
  onSave: (source: PromptSource) => void;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const { t } = useTranslation();
  const [draft, setDraft] = useState<PromptSource | null>(source);
  const fieldPrefix = useId();

  useEffect(() => {
    if (open && source) setDraft(createPromptSource(source));
  }, [open, source]);

  if (!draft) return null;

  const updateDraft = (patch: Partial<PromptSource>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));

  const save = () => {
    const result = validatePromptSourceDraft(draft);
    if (!result.valid) {
      const errorKey = {
        name: "config.promptSources.editor.nameRequired",
        url: "config.promptSources.editor.invalidUrl",
        homepage: "config.promptSources.editor.invalidHomepage",
      }[result.reason];
      message.warning(t(errorKey));
      return;
    }
    onSave(result.value);
    onClose();
  };

  const nameId = `${fieldPrefix}-name`;
  const urlId = `${fieldPrefix}-url`;
  const homepageId = `${fieldPrefix}-homepage`;

  return (
    <Drawer
      open={open}
      width={560}
      title={
        source?.name
          ? t("config.promptSources.editor.editTitle")
          : t("config.promptSources.editor.addTitle")
      }
      onClose={onClose}
      styles={{ body: { paddingTop: 16 } }}
      extra={
        <Space>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="primary" onClick={save}>
            {t("common.save")}
          </Button>
        </Space>
      }
    >
      <div className="space-y-5">
        <FormField id={nameId} label={t("config.promptSources.editor.name")}>
          <Input
            id={nameId}
            value={draft.name}
            onChange={(event) => updateDraft({ name: event.target.value })}
            placeholder={t("config.promptSources.editor.namePlaceholder")}
            autoFocus
          />
        </FormField>
        <FormField id={urlId} label="JSON URL">
          <Input
            id={urlId}
            value={draft.url}
            onChange={(event) => updateDraft({ url: event.target.value })}
            placeholder="https://example.com/prompts.json"
            inputMode="url"
          />
        </FormField>
        <FormField
          id={homepageId}
          label={t("config.promptSources.editor.homepage")}
        >
          <Input
            id={homepageId}
            value={draft.homepage}
            onChange={(event) => updateDraft({ homepage: event.target.value })}
            placeholder="https://example.com"
            inputMode="url"
          />
        </FormField>
        <div className="flex items-center justify-between border-y border-stone-200 py-3 dark:border-stone-800">
          <span className="text-sm font-medium">
            {t("config.promptSources.editor.enabled")}
          </span>
          <Switch
            checked={draft.enabled}
            onChange={(enabled) => updateDraft({ enabled })}
            aria-label={t("config.promptSources.editor.enabled")}
          />
        </div>
        <div>
          <div className="mb-2 text-sm font-medium">
            {t("config.promptSources.editor.jsonFormat")}
          </div>
          <pre className="overflow-x-auto rounded-md bg-stone-100 p-3 text-xs leading-5 text-stone-600 dark:bg-stone-900 dark:text-stone-300">
            {FORMAT_EXAMPLE}
          </pre>
        </div>
      </div>
    </Drawer>
  );
}

function FormField({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block" htmlFor={id}>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
