import { Alert, App, Button, Empty, Form, Input, Modal, Select, Skeleton, Switch, Tag } from "antd";
import { Check, KeyRound, Layers3, Pencil, Plus, RefreshCw, Server, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { getPlatformInit, onPlatformInit, platformRequest, type PlatformModels } from "@/platform/rpc";
import { ConfigPoolQuota, type ConfigPoolSnapshot } from "./config-pool-quota";

type ChannelModel = { name: string; capability: "image" | "video" | "text" | "vision" };
type ModelCandidate = { name: string; capability: ChannelModel["capability"] | "unknown" };
type ServerChannel = {
    id: string;
    name: string;
    baseUrl: string;
    apiFormat: "openai";
    enabled: boolean;
    hasKey: boolean;
    models: ChannelModel[];
};
type ChannelDraft = Omit<ServerChannel, "id" | "hasKey" | "models"> & { id?: string; apiKey: string; models: ModelCandidate[] };

const emptyDraft = (): ChannelDraft => ({ name: "", baseUrl: "https://api.openai.com/v1", apiFormat: "openai", enabled: true, apiKey: "", models: [] });
const errorMessage = (reason: unknown) => reason instanceof Error ? reason.message : "渠道操作失败，请稍后重试";
const MODEL_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,63}$/;
const capabilityLabels: Record<ChannelModel["capability"], string> = { image: "图像生成", video: "视频生成", text: "文本理解 / 规划", vision: "图像理解（配置）" };

function isModelAvailable(channel: ServerChannel, model: ChannelModel, catalog: PlatformModels) {
    if (model.capability === "vision") return false;
    if (model.capability === "text") return channel.enabled && channel.hasKey;
    return channel.enabled && catalog[model.capability].some((entry) => entry.id === `channel:${channel.id}:${model.name}` && entry.available);
}

function validPublicBase(value: string) {
    try {
        const url = new URL(value);
        const host = url.hostname.toLowerCase();
        if (url.protocol !== "https:" || url.port && url.port !== "443" || url.username || url.password || url.search || url.hash || value.trim().length > 512) return false;
        if (!host.includes(".") || host === "localhost" || /\.(?:localhost|local|internal)$/.test(host)) return false;
        if (/^[\d.]+$/.test(host)) {
            const parts = host.split(".").map(Number);
            if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
            const [a, b] = parts;
            if (a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127) return false;
        }
        return true;
    } catch { return false; }
}

export function ConfigServerChannels() {
    const { message, modal } = App.useApp();
    const [channels, setChannels] = useState<ServerChannel[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [pool, setPool] = useState<ConfigPoolSnapshot | null>(null);
    const [poolError, setPoolError] = useState("");
    const [refreshingQuota, setRefreshingQuota] = useState(false);
    const [catalog, setCatalog] = useState<PlatformModels>(() => getPlatformInit()?.models || { image: [], video: [] });
    const [editing, setEditing] = useState<ServerChannel | "new" | null>(null);
    const [pendingId, setPendingId] = useState("");
    const active = useRef(true);

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        const [channelResult, poolResult] = await Promise.allSettled([
            platformRequest<{ channels: ServerChannel[] }>("channels.list"),
            platformRequest<ConfigPoolSnapshot>("pool.snapshot"),
        ]);
        if (!active.current) return;
        if (channelResult.status === "fulfilled") setChannels(channelResult.value.channels);
        else setError(errorMessage(channelResult.reason));
        if (poolResult.status === "fulfilled") { setPool(poolResult.value); setPoolError(""); }
        else setPoolError(errorMessage(poolResult.reason));
        setLoading(false);
    }, []);
    useEffect(() => {
        active.current = true;
        void load();
        return () => { active.current = false; };
    }, [load]);
    useEffect(() => onPlatformInit((init) => setCatalog(init.models)), []);

    const refreshQuota = async () => {
        setRefreshingQuota(true); setPoolError("");
        try {
            const result = await platformRequest<ConfigPoolSnapshot>("pool.quota.refresh", {}, { timeoutMs: 100_000 });
            if (active.current) setPool(result);
        } catch (reason) {
            if (active.current) setPoolError(errorMessage(reason));
        } finally { if (active.current) setRefreshingQuota(false); }
    };
    const builtinModels = (["image", "video"] as const).flatMap((capability) => catalog[capability].filter((model) => !model.id.startsWith("channel:")).map((model) => ({ ...model, capability })));
    const builtinModelName = (model: (typeof builtinModels)[number]) => model.id.startsWith("muse-service-")
        ? `内置 Muse ${model.capability === "video" ? "视频" : "图像"}模型`
        : model.name || model.id;

    const save = async (draft: ChannelDraft) => {
        const result = await platformRequest<ServerChannel>("channels.save", {
            ...draft,
            apiKey: draft.apiKey.trim() || undefined,
            name: draft.name.trim(),
            baseUrl: draft.baseUrl.trim(),
            models: draft.models.map((model) => ({ ...model, name: model.name.trim() })),
        });
        setChannels((current) => current.some((channel) => channel.id === result.id) ? current.map((channel) => channel.id === result.id ? result : channel) : [...current, result]);
        setEditing(null);
        message.success("渠道已保存，模型目录已更新");
    };

    const toggle = async (channel: ServerChannel, enabled: boolean) => {
        setPendingId(channel.id);
        try {
            const result = await platformRequest<ServerChannel>("channels.save", { id: channel.id, name: channel.name, baseUrl: channel.baseUrl, apiFormat: "openai", enabled, models: channel.models });
            setChannels((current) => current.map((item) => item.id === result.id ? result : item));
        } catch (reason) {
            message.error(errorMessage(reason));
        } finally { setPendingId(""); }
    };

    const remove = (channel: ServerChannel) => modal.confirm({
        title: `移除「${channel.name}」？`,
        content: "将移除此渠道的服务端凭证和模型配置。现有画布及已生成的素材会保留。",
        okText: "移除渠道", cancelText: "取消", okButtonProps: { danger: true },
        onOk: async () => {
            try {
                await platformRequest("channels.delete", { id: channel.id });
                setChannels((current) => current.filter((item) => item.id !== channel.id));
                message.success("渠道已移除");
            } catch (reason) {
                message.error(errorMessage(reason));
                throw reason;
            }
        },
    });

    return <div className="ff-config-section">
        <div className="ff-config-section-heading">
            <div><h3>生成渠道</h3><p>连接自己的模型服务，为画布生成和剪辑 Agent 配置模型。</p></div>
            <Button type="primary" icon={<Plus size={15} />} onClick={() => setEditing("new")}>添加渠道</Button>
        </div>
        <div className="ff-config-builtin">
            <div className="ff-config-service-icon"><Layers3 size={19} /></div>
            <div className="min-w-0 flex-1"><strong>内置模型与账号</strong><p>Muse 模型、个人网站账号与共享额度。</p></div>
            <Button size="small" icon={<RefreshCw size={13} />} loading={refreshingQuota} disabled={loading} onClick={() => void refreshQuota()}>同步额度</Button>
        </div>
        {poolError ? <Alert className="mt-3" type="warning" showIcon message="账号额度暂时无法同步" description={poolError} /> : null}
        {pool?.sharedChannels ? <ConfigPoolQuota title="内置 Muse 共享服务" quota={pool.sharedChannels.muse.quota} /> : null}
        <div className="ff-config-model-directory" aria-label="内置模型">
            <div className="ff-config-model-heading"><strong>内置模型</strong><span>{builtinModels.length} 个模型</span></div>
            {builtinModels.map((model) => <div className="ff-config-model-row" key={model.id}>
                <div><strong>{builtinModelName(model)}</strong><code>{model.id}</code></div>
                <span className="ff-config-model-capability">{model.capability === "image" ? "图像" : "视频"}</span>
                <Tag className="m-0" color={model.available ? "green" : undefined}>{model.available ? "可选" : "暂不可用"}</Tag>
            </div>)}
            {!builtinModels.length ? <p className="ff-config-quota-unavailable">尚未读取模型目录，刷新后重试。</p> : null}
        </div>
        <div className="ff-config-list-heading"><span>我的 API 渠道 <b>{channels.length}</b></span><Button type="text" size="small" icon={<RefreshCw size={13} />} loading={loading} onClick={() => void load()}>刷新</Button></div>
        {error ? <Alert type="error" showIcon message="无法读取渠道" description={error} action={<Button size="small" onClick={() => void load()}>重试</Button>} /> : null}
        {loading && !channels.length ? <Skeleton active paragraph={{ rows: 3 }} /> : !error && !channels.length ? <div className="ff-config-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有自定义渠道" /><p>添加兼容 OpenAI 的服务地址与 API Key，即可配置文生图、文生视频和剪辑 Agent 文本模型。</p><Button icon={<Plus size={14} />} onClick={() => setEditing("new")}>连接第一个渠道</Button></div> : null}
        <div className="ff-config-channel-list">{channels.map((channel) => <section className="ff-config-channel" key={channel.id}>
            <div className="ff-config-channel-main">
                <div className="ff-config-service-icon"><Server size={18} /></div>
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong>{channel.name}</strong><span className="ff-config-protocol">OpenAI 兼容</span></div><p className="truncate" title={channel.baseUrl}>{channel.baseUrl}</p></div>
                <Switch size="small" aria-label={`启用${channel.name}`} checked={channel.enabled} loading={pendingId === channel.id} onChange={(value) => void toggle(channel, value)} />
            </div>
            <div className="ff-config-channel-models" aria-label={`${channel.name}模型`}>{channel.models.length ? channel.models.map((model) => <div className="ff-config-model-row" key={model.name}>
                <div><strong>{model.name}</strong><code>{capabilityLabels[model.capability]}</code></div>
                <Tag className="m-0" color={isModelAvailable(channel, model, catalog) ? "green" : undefined}>{!channel.enabled ? "已停用" : model.capability === "vision" ? "调用尚未接入" : isModelAvailable(channel, model, catalog) ? "可选" : "暂不可用"}</Tag>
            </div>) : <p className="ff-config-quota-unavailable">尚未配置模型，可编辑渠道并读取模型列表。</p>}</div>
            <div className="ff-config-channel-footer"><div className="flex flex-wrap items-center gap-3"><span><KeyRound size={12} />{channel.hasKey ? "凭证已加密保存" : "未配置凭证"}</span><span>{channel.models.filter((item) => item.capability === "image").length} 个图像 · {channel.models.filter((item) => item.capability === "video").length} 个视频 · {channel.models.filter((item) => item.capability === "text").length} 个文本 · {channel.models.filter((item) => item.capability === "vision").length} 个图像理解配置</span></div><div className="flex gap-1"><Button size="small" type="text" icon={<Pencil size={13} />} onClick={() => setEditing(channel)}>编辑</Button><Button size="small" type="text" danger icon={<Trash2 size={14} />} aria-label={`移除${channel.name}`} onClick={() => remove(channel)} /></div></div>
        </section>)}</div>
        <p className="ff-config-note"><Check size={13} />渠道仅本人可见。API Key 仅加密保存在服务端，配置导出不包含凭证。</p>
        {editing ? <ServerChannelEditor channel={editing === "new" ? null : editing} onCancel={() => setEditing(null)} onSave={save} /> : null}
    </div>;
}

function ServerChannelEditor({ channel, onCancel, onSave }: { channel: ServerChannel | null; onCancel: () => void; onSave: (draft: ChannelDraft) => Promise<void> }) {
    const [draft, setDraft] = useState<ChannelDraft>(() => channel ? { id: channel.id, name: channel.name, baseUrl: channel.baseUrl, apiFormat: "openai", enabled: channel.enabled, apiKey: "", models: channel.models.map((model) => ({ ...model })) } : emptyDraft());
    const [saving, setSaving] = useState(false);
    const [probing, setProbing] = useState(false);
    const [error, setError] = useState("");
    const [probeInfo, setProbeInfo] = useState("");
    const [form] = Form.useForm();
    const canProbe = Boolean(channel && channel.baseUrl === draft.baseUrl && !draft.apiKey);
    const changedOrigin = (() => { try { return Boolean(channel && new URL(channel.baseUrl).origin !== new URL(draft.baseUrl).origin); } catch { return false; } })();
    const update = <K extends keyof ChannelDraft>(key: K, value: ChannelDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

    const submit = async () => {
        setError("");
        try {
            await form.validateFields();
            const models = draft.models.filter((model) => model.name.trim());
            if (models.length > 100) throw new Error("每个渠道最多配置 100 个模型");
            if (models.some((model) => !["image", "video", "text", "vision"].includes(model.capability))) throw new Error("有模型能力尚未确认，请选择能力或移除该模型；未知模型不会自动作为文本模型。");
            if (models.some((model) => !MODEL_NAME.test(model.name.trim()))) throw new Error("模型 ID 须以字母或数字开头，长度 1–64，只能包含字母、数字、点、下划线、斜杠和连字符");
            if (new Set(models.map((model) => model.name.trim())).size !== models.length) throw new Error("模型名称重复，请保留一个并选择对应能力");
            setSaving(true);
            await onSave({ ...draft, models });
        } catch (reason) {
            if (reason instanceof Error) setError(reason.message);
        } finally { setSaving(false); }
    };

    const probe = async () => {
        if (!channel || !canProbe) return;
        setProbing(true); setError(""); setProbeInfo("");
        try {
            const result = await platformRequest<{ models: ModelCandidate[] }>("channels.probe", { id: channel.id });
            if (!result.models.length) { setProbeInfo("服务未返回可用模型，可在下方手动填写模型 ID。"); return; }
            setDraft((current) => ({ ...current, models: Array.from(new Map([...current.models, ...result.models].map((model) => [model.name, current.models.find((existing) => existing.name === model.name) || model])).values()) }));
            setProbeInfo(`已读取 ${result.models.length} 个模型。请确认每项能力；未知模型需要选择能力后才能保存，图像理解目前仅保存配置。`);
        } catch (reason) { setError(errorMessage(reason)); }
        finally { setProbing(false); }
    };

    return <Modal title={channel ? "编辑生成渠道" : "连接生成渠道"} open onCancel={saving ? undefined : onCancel} width={620} centered destroyOnHidden footer={<div className="flex justify-between gap-2"><span className="self-center text-xs text-stone-500">API Key 不会保存到浏览器</span><div className="flex gap-2"><Button onClick={onCancel} disabled={saving}>取消</Button><Button type="primary" onClick={() => void submit()} loading={saving}>保存渠道</Button></div></div>} styles={{ body: { maxHeight: "66vh", overflowY: "auto" } }}>
        <Form form={form} layout="vertical" requiredMark={false} initialValues={{ name: draft.name, baseUrl: draft.baseUrl, apiKey: "" }}>
            {error ? <Alert className="mb-4" type="error" showIcon message={error} /> : null}
            <Form.Item label="渠道名称" name="name" rules={[{ required: true, whitespace: true, message: "填写一个方便识别的名称" }, { max: 80, message: "名称不超过 80 个字符" }]}><Input placeholder="例如：我的图像服务" maxLength={80} onChange={(event) => update("name", event.target.value)} /></Form.Item>
            <Form.Item label="服务地址" name="baseUrl" extra="使用 HTTPS 443 公网 API 基础地址，可包含 /v1；本机 Muse 请通过账号池接入。" rules={[{ required: true, message: "填写服务地址" }, { validator: (_, value: string) => validPublicBase(value) ? Promise.resolve() : Promise.reject(new Error("填写 HTTPS 443 公网地址，不含账号、查询参数或片段；域名解析由服务端校验")) }]}><Input placeholder="https://api.example.com/v1" maxLength={512} onChange={(event) => update("baseUrl", event.target.value)} /></Form.Item>
            <Form.Item label="API Key" name="apiKey" extra={changedOrigin ? "切换服务域名后，需要重新填写 API Key。" : channel?.hasKey ? "凭证已保存在服务端，留空继续使用；输入新 Key 可替换。" : "凭证会通过平台接口加密保存。"} rules={[{ validator: (_, value: string) => {
                const key = value?.trim() || "";
                if (!key && (!channel?.hasKey || changedOrigin)) return Promise.reject(new Error(changedOrigin ? "切换服务域名需要重新填写 API Key" : "填写此渠道的 API Key"));
                if (key.length > 8192 || /[\x00-\x1F\x7F]/.test(key)) return Promise.reject(new Error("API Key 格式无效"));
                return Promise.resolve();
            } }]}><Input.Password autoComplete="new-password" maxLength={8192} placeholder={channel?.hasKey ? "已配置，留空不变" : "输入 API Key"} onChange={(event) => update("apiKey", event.target.value)} /></Form.Item>
            <div className="mb-4 flex items-center justify-between rounded-lg border border-stone-200 p-3 dark:border-stone-800"><span className="text-sm">在模型选择器中启用此渠道</span><Switch checked={draft.enabled} onChange={(checked) => update("enabled", checked)} /></div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">模型与能力</strong><Button size="small" icon={<RefreshCw size={13} />} disabled={!canProbe} loading={probing} onClick={() => void probe()}>读取模型</Button></div>
            {!canProbe ? <p className="mb-3 text-xs text-stone-500">首次添加或修改凭证后，保存渠道即可重新进入并读取模型。也可直接填写模型 ID。</p> : null}
            {probeInfo ? <Alert className="mb-3" type="info" showIcon message={probeInfo} /> : null}
            <div className="space-y-2">{draft.models.map((model, index) => <div className="flex gap-2" key={index}><Input aria-label={`模型 ${index + 1} ID`} placeholder="模型 ID，例如 gpt-image-1" maxLength={64} status={model.name.trim() && !MODEL_NAME.test(model.name.trim()) ? "error" : undefined} value={model.name} onChange={(event) => update("models", draft.models.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} /><Select className="w-44 shrink-0" aria-label={`模型 ${index + 1} 能力`} value={model.capability} options={[{ value: "unknown", label: "请选择模型能力", disabled: true }, ...Object.entries(capabilityLabels).map(([value, label]) => ({ value, label }))]} onChange={(capability: ModelCandidate["capability"]) => update("models", draft.models.map((item, i) => i === index ? { ...item, capability } : item))} /><Button icon={<Trash2 size={14} />} aria-label={`移除模型 ${index + 1}`} onClick={() => update("models", draft.models.filter((_, i) => i !== index))} /></div>)}</div>
            <p className="mt-2 text-xs text-stone-500">模型 ID 最多 64 字符，仅允许字母、数字和 . _ / -，以字母或数字开头。</p>
            <Button className="mt-3" size="small" type="dashed" disabled={draft.models.length >= 100} icon={<Plus size={13} />} onClick={() => update("models", [...draft.models, { name: "", capability: "image" }])}>添加模型</Button>
            <Alert className="mt-4" type="info" showIcon message="接入范围" description="自定义渠道支持 OpenAI 兼容文生图、异步文生视频、科普脚本与剪辑 Agent 文本规划。图像理解模型目前仅保存配置，图像理解调用、参考图、多模态编辑、Gemini 和音频接口尚未接入；平台账号池仍可用于已有的参考图生成能力。" />
        </Form>
    </Modal>;
}
