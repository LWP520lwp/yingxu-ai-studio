import { useCallback, useState } from "react";
import { Button, Tooltip } from "antd";
import { BookOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

export function CanvasPromptLibrary({ onSelect }: { onSelect: (prompt: string) => void }) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const choosePrompt = useCallback((content: string) => {
    setIsOpen(false);
    onSelect(content);
  }, [onSelect]);

  return (
    <>
      <Tooltip title={t("navigation.prompts")}>
        <Button
          type="text"
          shape="circle"
          className="!h-8 !w-8 !min-w-8 shrink-0 !bg-transparent !p-0"
          style={{ color: theme.node.text }}
          icon={<BookOpen className="size-3.5" />}
          onClick={() => setIsOpen(true)}
          aria-label={t("navigation.prompts")}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
        />
      </Tooltip>
      <PromptSelectDialog open={isOpen} onOpenChange={setIsOpen} onSelect={choosePrompt} />
    </>
  );
}
