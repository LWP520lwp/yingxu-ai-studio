import { Button, Modal } from "antd";
import {
  ArrowUpRight,
  Atom,
  BookOpen,
  Boxes,
  MousePointer2,
  Settings2,
  Sparkles,
} from "lucide-react";

import { DOCS_URL } from "@/constant/env";

type AppHelpModalProps = {
  open: boolean;
  onClose: () => void;
};

const helpSections = [
  {
    title: "创作画布",
    icon: MousePointer2,
    description:
      "双击空白处添加节点；使用抓手平移画布、Shift 拖动框选，再连接端口组合文字、图像、视频与生成配置。",
  },
  {
    title: "科普短视频",
    icon: Atom,
    description:
      "整理主题和资料，生成解说与分镜；确认内容后制作动态片段、配音、字幕和成片。",
  },
  {
    title: "Skill 市场",
    icon: Sparkles,
    description:
      "在工作台的 Skill 市场浏览、导入和管理创作方案；画布节点插件可扩展节点能力。",
  },
  {
    title: "模型与账号",
    icon: Settings2,
    description:
      "创作设置用于配置生成渠道与模型；账号菜单中的账号池用于管理账号并查看可用额度。",
  },
] as const;

export function AppHelpModal({ open, onClose }: AppHelpModalProps) {
  return (
    <Modal
      title={
        <span className="flex items-center gap-2 text-base font-semibold">
          <BookOpen className="size-[18px] text-emerald-600 dark:text-emerald-400" />
          <span>映序使用帮助</span>
        </span>
      }
      open={open}
      onCancel={onClose}
      footer={
        <Button type="primary" onClick={onClose}>
          继续创作
        </Button>
      }
      width="min(620px, calc(100vw - 24px))"
      centered
      destroyOnHidden
      styles={{ body: { padding: "8px 24px 20px" } }}
    >
      <div className="divide-y divide-stone-200 dark:divide-stone-800">
        {helpSections.map(({ title, icon: Icon, description }) => (
          <section
            key={title}
            className="grid grid-cols-[32px_minmax(0,1fr)] gap-x-3 py-4 first:pt-2 last:pb-3"
          >
            <span className="grid size-8 place-items-center rounded-md bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                {title}
              </h2>
              <p className="mt-1 text-sm leading-6 text-stone-600 dark:text-stone-400">
                {description}
              </p>
            </div>
          </section>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-4 dark:border-stone-800">
        <p className="flex min-w-0 items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
          <Boxes className="size-3.5 shrink-0" aria-hidden="true" />
          <span>画布顶部的主页与项目入口会返回草稿库。</span>
        </p>
        {DOCS_URL ? (
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-emerald-700 underline decoration-emerald-700/40 underline-offset-4 hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-emerald-300"
          >
            部署文档
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
            <span className="sr-only">（在新标签页打开）</span>
          </a>
        ) : null}
      </div>
    </Modal>
  );
}
