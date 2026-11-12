import { InfoCircleOutlined } from "@ant-design/icons";
import { Modal } from "antd";
import { useState } from "react";
import { version } from "../../../package.json";
import { cn } from "@/lib/utils";

type GitHubLinkProps = {
    className?: string;
    style?: React.CSSProperties;
};

const productAreas = [
    { title: "AI 创作画布", description: "将灵感、素材与生成配置组织为可编辑的创作流程。" },
    { title: "Skill 技能库", description: "为图像和视频任务组合镜头、动作及视觉效果指令。" },
    { title: "生成账号池", description: "集中查看已接入渠道、账号状态和可用额度。" },
];

export function GitHubLink({ className, style }: GitHubLinkProps) {
    const [visible, setVisible] = useState(false);
    const close = () => setVisible(false);

    return (
        <>
            <button
                type="button"
                className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-full text-stone-600 transition hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white", className)}
                style={style}
                onClick={() => setVisible(true)}
                aria-label="关于映序"
                title="关于映序"
            >
                <InfoCircleOutlined className="text-base" />
            </button>
            <Modal
                title={<span className="flex items-center gap-2"><InfoCircleOutlined />关于映序</span>}
                open={visible}
                onCancel={close}
                footer={null}
                width={520}
                centered
            >
                <div className="space-y-4 py-2 text-sm leading-7">
                    <p>映序为 AI 影像创作提供一个连续、可编辑的工作空间。</p>
                    <dl className="space-y-4 rounded-lg border border-stone-200 p-4 dark:border-stone-700">
                        {productAreas.map((area) => (
                            <div key={area.title}>
                                <dt className="font-semibold">{area.title}</dt>
                                <dd className="mt-1 text-stone-600 dark:text-stone-300">{area.description}</dd>
                            </div>
                        ))}
                    </dl>
                    <p className="border-t border-stone-200 pt-3 text-xs text-stone-600 dark:border-stone-700 dark:text-stone-400">
                        映序 · 版本 {version}
                    </p>
                </div>
            </Modal>
        </>
    );
}
