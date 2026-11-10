import { InfoCircleOutlined } from "@ant-design/icons";
import { Modal } from "antd";
import { useState } from "react";
import { version } from "../../../package.json";

import { cn } from "@/lib/utils";

type GitHubLinkProps = {
    className?: string;
    style?: React.CSSProperties;
};

export function GitHubLink({ className, style }: GitHubLinkProps) {
    const [open, setOpen] = useState(false);
    return (
        <><button
            type="button"
            className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-full text-stone-600 transition hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white", className)}
            style={style}
            onClick={() => setOpen(true)}
            aria-label="关于映序"
            title="关于映序"
        >
            <InfoCircleOutlined className="text-base" />
        </button><Modal title={<span className="flex items-center gap-2"><InfoCircleOutlined />关于映序</span>} open={open} onCancel={() => setOpen(false)} footer={null} width={520} centered>
            <div className="space-y-4 py-2 text-sm leading-7">
                <p>映序将灵感、素材与 AI 生成能力组织在同一个创作空间，让想法逐步成为作品。</p>
                <dl className="space-y-4 rounded-lg border border-stone-200 p-4 dark:border-stone-700">
                    <div><dt className="font-semibold">AI 创作画布</dt><dd className="mt-1 text-stone-600 dark:text-stone-300">用节点连接文字、参考图片与视频生成配置，编排创作流程。</dd></div>
                    <div><dt className="font-semibold">Skill 技能库</dt><dd className="mt-1 text-stone-600 dark:text-stone-300">安装和切换创作技能，将镜头内容与运镜、动作及视觉效果配方组合。</dd></div>
                    <div><dt className="font-semibold">生成账号池</dt><dd className="mt-1 text-stone-600 dark:text-stone-300">统一管理生成账号与模型渠道，查看可用状态及剩余额度。</dd></div>
                </dl>
                <p className="border-t border-stone-200 pt-3 text-xs text-stone-600 dark:border-stone-700 dark:text-stone-400">映序 · 版本 {version}</p>
            </div>
        </Modal></>
    );
}
