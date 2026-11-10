import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowUpRight,
  Sparkle,
  X,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";
import type { Job } from "./types";

export const cn = (...values: Parameters<typeof clsx>) =>
  twMerge(clsx(...values));
export const jobNames: Record<string, string> = {
  queued: "等待执行",
  running: "正在生成",
  waiting_provider: "生成处理中",
  succeeded: "生成完成",
  failed: "生成失败",
  cancel_requested: "正在取消",
  cancelled: "已取消",
  unknown_external: "等待核对",
};
export const finished = (job: Job) =>
  ["succeeded", "failed", "cancelled", "unknown_external"].includes(job.status);
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className={cn("dialog-content", className)}>
          <div className="dialog-header">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="关闭对话框">
              <X size={20} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="dialog-description">
            {description || "管理当前工作台。"}
          </Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Empty({
  icon: Icon,
  title,
  detail,
  children,
}: {
  icon: typeof Sparkle;
  title: string;
  detail: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={30} weight="thin" />
      </span>
      <h2>{title}</h2>
      <p>{detail}</p>
      {children}
    </div>
  );
}
export function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
      <ArrowUpRight size={14} />
    </a>
  );
}
