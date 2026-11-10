import { useId } from "react";
import type { VideoSkillOption } from "./videoGenerationSkill";

/** Shared by the canvas video node and the editing workbench generation form. */
export function VideoSkillSelect({ skills, value, onChange, onInstall, onManage, onRefresh, disabled, installing, className = "" }: {
  skills: readonly VideoSkillOption[];
  value: string;
  onChange: (id: string) => void;
  onInstall?: (skill: VideoSkillOption) => void;
  onManage?: () => void;
  onRefresh?: () => void;
  disabled?: boolean;
  installing?: boolean;
  className?: string;
}) {
  const id = useId();
  const selected = skills.find((skill) => skill.id === value);
  return <div className={`video-skill-select ${className}`}>
    <label htmlFor={id}>视频 Skill</label>
    <select id={id} aria-label="视频 Skill" value={value} disabled={disabled || installing} onChange={(event) => onChange(event.target.value)}>
      <option value="">自定义镜头 · 不使用 Skill</option>
      {value && !selected && <option value={value}>所选 Skill 暂不可用，请重新选择</option>}
      {[{ source: "imported", label: "我的导入" }, { source: "builtin", label: "创作精选" }].map((group) => {
        const options = skills.filter((skill) => (skill.source || "builtin") === group.source);
        return options.length > 0 ? <optgroup label={group.label} key={group.source}>{options.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}{skill.installed ? "" : "（需安装）"}</option>)}</optgroup> : null;
      })}
    </select>
    {selected && <p>{selected.description || "将此技能的创作方法与镜头文字、参考图片共同用于生成。"}{selected.requiresReference ? " 需要参考图片。" : " 可选参考图片。"}</p>}
    {selected && !selected.installed && (onInstall ? <button type="button" disabled={disabled || installing} onClick={() => onInstall(selected)}>{installing ? "正在安装…" : "安装并使用此 Skill"}</button> : <p>请先在 Skill 市场安装当前版本。</p>)}
    {(onManage || onRefresh) && <div className="video-skill-actions">{onManage && <button type="button" disabled={disabled || installing} onClick={onManage}>导入 / 管理 Skill</button>}{onRefresh && <button type="button" disabled={disabled || installing} onClick={onRefresh} aria-label="刷新视频 Skill 列表">刷新技能</button>}</div>}
  </div>;
}
