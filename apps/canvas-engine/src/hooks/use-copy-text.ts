import { App } from "antd";
import copy from "copy-to-clipboard";
import { useTranslation } from "react-i18next";

import { copyTextWithFallback } from "@/lib/clipboard";

export function useCopyText() {
  const { message } = App.useApp();
  const { t } = useTranslation();

  return async (value: string, successText = t("common.copied")) => {
    const copied = await copyTextWithFallback(value, {
      writeText:
        typeof navigator !== "undefined" && navigator.clipboard
          ? (text) => navigator.clipboard.writeText(text)
          : undefined,
      fallback: async (text) => copy(text, { format: "text/plain" }),
    });
    if (copied) message.success(successText);
    else message.error(t("common.copyFailed"));
  };
}
