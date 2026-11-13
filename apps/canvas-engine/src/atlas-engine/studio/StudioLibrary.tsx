import { useEffect, useState } from "react";
import { Modal, Input } from "antd";
import { useTranslation } from "react-i18next";
import { useAssetStore } from "@/stores/use-asset-store";
import { platformRequest, type PlatformAsset } from "@/platform/rpc";
import type { InsertAssetPayload } from "@/atlas-engine/ui/asset-picker";

export default function StudioLibrary({
  onClose,
  onInsert,
}: {
  onClose: () => void;
  onInsert: (value: InsertAssetPayload) => void;
}) {
  const { i18n } = useTranslation();
  const zh = !i18n.resolvedLanguage?.startsWith("en");
  const local = useAssetStore((state) => state.assets);
  const [remote, setRemote] = useState<PlatformAsset[]>([]);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    void platformRequest<PlatformAsset[]>(
      "assets.list",
      {},
      { signal: abort.signal },
    )
      .then(setRemote)
      .catch((reason) => {
        if (!abort.signal.aborted) setError(String(reason.message));
      });
    return () => abort.abort();
  }, []);
  const items = local.flatMap<{
    id: string;
    title: string;
    preview?: string;
    payload: InsertAssetPayload;
  }>((asset) =>
    asset.kind === "text"
      ? [
          {
            id: asset.id,
            title: asset.title,
            payload: {
              kind: "text",
              title: asset.title,
              content: asset.data.content,
            },
          },
        ]
      : asset.kind === "image"
        ? [
            {
              id: asset.id,
              title: asset.title,
              preview: asset.data.dataUrl,
              payload: {
                kind: "image",
                title: asset.title,
                dataUrl: asset.data.dataUrl,
                storageKey: asset.data.storageKey,
              },
            },
          ]
        : [
            {
              id: asset.id,
              title: asset.title,
              payload: {
                kind: "video",
                title: asset.title,
                url: asset.data.url,
                storageKey: asset.data.storageKey,
              },
            },
          ],
  );
  for (const asset of remote) {
    if (asset.mimeType.startsWith("image/"))
      items.push({
        id: asset.id,
        title: asset.name,
        preview: asset.url,
        payload: { kind: "image", title: asset.name, dataUrl: asset.url },
      });
    else if (asset.mimeType.startsWith("video/"))
      items.push({
        id: asset.id,
        title: asset.name,
        payload: { kind: "video", title: asset.name, url: asset.url },
      });
  }
  return (
    <Modal
      open
      title={zh ? "素材架" : "Materials"}
      onCancel={onClose}
      footer={null}
      width={760}
      destroyOnHidden
    >
      <Input
        aria-label={zh ? "搜索素材" : "Find materials"}
        placeholder={
          zh ? "按名称搜索图片、视频或文本" : "Find images, clips or notes"
        }
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {error && <p role="status">{error}</p>}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))",
          gap: 12,
          marginTop: 18,
          maxHeight: "60vh",
          overflow: "auto",
        }}
      >
        {items
          .filter((item) =>
            item.title.toLowerCase().includes(query.toLowerCase()),
          )
          .map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onInsert(item.payload)}
              style={{
                padding: 12,
                border: "1px solid var(--border)",
                borderRadius: 8,
                textAlign: "left",
                background: "var(--card)",
                color: "var(--foreground)",
              }}
            >
              {item.preview && (
                <img
                  src={item.preview}
                  alt=""
                  loading="lazy"
                  style={{
                    width: "100%",
                    height: 100,
                    objectFit: "cover",
                    borderRadius: 5,
                    marginBottom: 10,
                  }}
                />
              )}
              <span>{item.title}</span>
              <small style={{ display: "block", opacity: 0.55, marginTop: 5 }}>
                {item.payload.kind.toUpperCase()}
              </small>
            </button>
          ))}
      </div>
      {!items.length && (
        <p style={{ padding: "40px 0", textAlign: "center" }}>
          {zh
            ? "素材架还是空的。上传素材后，可以在任意画布中复用。"
            : "Upload a material to reuse it across your canvases."}
        </p>
      )}
    </Modal>
  );
}
