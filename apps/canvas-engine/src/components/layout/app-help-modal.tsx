import { Button, Modal } from "antd";
import { ArrowUpRight, Atom, BookOpen, Clapperboard, MousePointer2, Sparkles } from "lucide-react";
import { DOCS_URL } from "@/constant/env";

export function AppHelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    return <Modal title={<span className="flex items-center gap-2"><BookOpen size={18} />映序使用帮助</span>} open={open} onCancel={onClose} footer={<Button onClick={onClose}>继续创作</Button>} width={560} centered>
        <div className="space-y-5 py-3 text-sm leading-7">
            <section><h3 className="mb-1 flex items-center gap-2 font-semibold"><MousePointer2 size={16} />AI 创作画布</h3><p className="text-stone-500">双击空白新建节点，点击节点打开操作工具。连接节点两侧的圆点，将文字、参考图与生成配置组合起来。拖动空白平移，滚轮缩放，Shift 拖动框选。</p></section>
            <section><h3 className="mb-1 flex items-center gap-2 font-semibold"><Sparkles size={16} />Skill 与生成服务</h3><p className="text-stone-500">在 Skill 市场选择并安装技能；文字节点可以选择视频 Skill，准备生成配置。创作设置中管理渠道与模型，账号池中接入账号并查看可用额度。</p></section>
            <section><h3 className="mb-1 flex items-center gap-2 font-semibold"><Atom size={16} />科普短视频</h3><p className="text-stone-500">在独立的科普制作模块中整理主题、资料和解说，校对分镜与来源后生成配音和视频，也可将成片送入 Agent 剪辑继续调整。</p></section>
            <section><h3 className="mb-1 flex items-center gap-2 font-semibold"><Clapperboard size={16} />Agent 剪辑</h3><p className="text-stone-500">从主页进入 Agent 剪辑，左侧导入或生成素材、使用 Agent 规划剪辑，右侧通过视频预览与多轨时间线调整成片。</p></section>
            <p className="border-t border-stone-200 pt-3 text-xs text-stone-500 dark:border-stone-800">画布菜单中的「主页」返回本项目工作台，「项目」打开项目列表。画布右下角显示项目同步状态。</p>
            {DOCS_URL ? <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm underline">部署文档（外部网站）<ArrowUpRight size={14} /></a> : null}
        </div>
    </Modal>;
}
