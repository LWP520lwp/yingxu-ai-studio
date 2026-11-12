import i18n from "@/i18n";
import type { ReferenceImage } from "@/types/image";

export function imageReferenceLabel(index: number) {
  const ordinal = Number.isFinite(index) ? Math.max(0, Math.floor(index)) + 1 : 1;
  return i18n.t("imageReferences.label", { index: ordinal });
}

export function buildImageReferencePromptText(prompt: string, references: readonly ReferenceImage[]) {
  const text = prompt.trim();
  if (!references.length) return text;

  const labels = references
    .map((_, index) => imageReferenceLabel(index))
    .join(i18n.t("imageReferences.separator"));
  return i18n.t("imageReferences.promptPrefix", { labels, prompt: text });
}
