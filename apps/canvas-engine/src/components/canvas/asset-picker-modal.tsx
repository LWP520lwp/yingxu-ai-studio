import { useEffect, useMemo, useReducer, useSyncExternalStore } from "react";
import { Empty, Input, Modal, Pagination } from "antd";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  ASSET_PICKER_PAGE_SIZE,
  toInsertAssetPayload,
  type AssetPickerKindFilter,
  type InsertAssetPayload,
} from "@/atlas-engine/ui/asset-picker";
import {
  createAssetPickerQuery,
  deriveAssetPickerPage,
  transitionAssetPickerQuery,
} from "@/atlas-engine/ui/asset-picker-session";
import {
  getImagePreviewRevision,
  subscribeImagePreviews,
} from "@/services/image-storage";
import {
  assetCoverUrl,
  useAssetStore,
  type Asset,
  type AssetKind,
} from "@/stores/use-asset-store";

export type { InsertAssetPayload };

type Props = {
  open: boolean;
  defaultTab?: AssetPickerKindFilter;
  onInsert: (payload: InsertAssetPayload) => void;
  onClose: () => void;
};

export function AssetPickerModal({
  open,
  defaultTab = "all",
  onInsert,
  onClose,
}: Props) {
  const { t } = useTranslation();
  return (
    <Modal
      title={t("canvas.assetPicker.title")}
      open={open}
      onCancel={onClose}
      footer={null}
      width="min(860px, calc(100vw - 24px))"
      destroyOnHidden
      styles={{ body: { padding: "0 20px 20px", minHeight: 360 } }}
    >
      <MyAssetsTab defaultKind={defaultTab} onInsert={onInsert} />
    </Modal>
  );
}

const kindOptions: AssetPickerKindFilter[] = ["all", "text", "image", "video"];

function PickerCard({
  title,
  kind,
  cover,
  onClick,
}: {
  title: string;
  kind: AssetKind;
  cover: string;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="group relative min-w-0 cursor-pointer overflow-hidden rounded-md border border-stone-200 bg-white text-left transition hover:border-stone-400 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 dark:border-stone-700 dark:bg-stone-900 dark:hover:border-stone-500"
      onClick={onClick}
      aria-label={`${t("canvas.assetPicker.insert")}: ${title}`}
    >
      {cover ? (
        <img src={cover} alt="" className="aspect-[4/3] w-full object-cover" />
      ) : (
        <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-3 text-center text-xs leading-5 text-stone-500 dark:bg-stone-800 dark:text-stone-400">
          {title}
        </div>
      )}
      <div className="p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="line-clamp-1 min-w-0 text-xs font-medium text-stone-800 dark:text-stone-200">
            {title}
          </span>
          <span className="shrink-0 text-[10px] text-stone-500 dark:text-stone-400">
            {t(`assets.kinds.${kind}`)}
          </span>
        </div>
      </div>
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-stone-950/0 text-sm font-medium text-white opacity-0 transition group-hover:bg-stone-950/55 group-hover:opacity-100 group-focus-visible:bg-stone-950/55 group-focus-visible:opacity-100">
        {t("canvas.assetPicker.insert")}
      </span>
    </button>
  );
}

function MyAssetsTab({
  defaultKind,
  onInsert,
}: {
  defaultKind: AssetPickerKindFilter;
  onInsert: (payload: InsertAssetPayload) => void;
}) {
  const { t } = useTranslation();
  useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
  const assets = useAssetStore((state) => state.assets);
  const [query, dispatch] = useReducer(
    transitionAssetPickerQuery,
    defaultKind,
    createAssetPickerQuery,
  );
  const { matches, items, page } = useMemo(
    () => deriveAssetPickerPage(assets, query),
    [assets, query],
  );

  useEffect(() => {
    dispatch({ type: "reconcile-results", resultCount: matches.length });
  }, [matches.length]);

  useEffect(() => {
    dispatch({ type: "restore-kind", kind: defaultKind });
  }, [defaultKind]);

  const handleInsert = (asset: Asset) => {
    onInsert(toInsertAssetPayload(asset));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Input
          className="w-full sm:max-w-64"
          size="small"
          prefix={<Search className="size-3.5 text-stone-400" />}
          placeholder={t("canvas.assetPicker.search")}
          aria-label={t("canvas.assetPicker.search")}
          value={query.text}
          allowClear
          onChange={(event) =>
            dispatch({ type: "search", text: event.target.value })
          }
        />
        <div
          className="flex w-full flex-wrap gap-1 rounded-md bg-stone-100 p-1 sm:w-auto dark:bg-stone-800"
          role="group"
          aria-label={t("canvas.assetPicker.title")}
        >
          {kindOptions.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={query.kind === option}
              className={`min-h-8 flex-1 rounded px-2 text-xs transition sm:flex-none ${query.kind === option ? "bg-white font-medium text-stone-900 shadow-sm dark:bg-stone-700 dark:text-white" : "text-stone-600 hover:text-stone-900 dark:text-stone-300 dark:hover:text-white"}`}
              onClick={() => dispatch({ type: "filter-kind", kind: option })}
            >
              {option === "all" ? t("common.all") : t(`assets.kinds.${option}`)}
            </button>
          ))}
        </div>
      </div>

      {items.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((asset) => (
            <PickerCard
              key={asset.id}
              title={asset.title}
              kind={asset.kind}
              cover={assetCoverUrl(asset)}
              onClick={() => handleInsert(asset)}
            />
          ))}
        </div>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("canvas.assetPicker.empty")}
          className="py-12"
        />
      )}

      {matches.length > ASSET_PICKER_PAGE_SIZE && (
        <div className="flex justify-center">
          <Pagination
            size="small"
            current={page}
            pageSize={ASSET_PICKER_PAGE_SIZE}
            total={matches.length}
            onChange={(nextPage) =>
              dispatch({ type: "change-page", page: nextPage })
            }
            showSizeChanger={false}
          />
        </div>
      )}
    </div>
  );
}
