import type { CreativeData, Model } from "./types";

export const modelId = (model: Model | string) =>
  typeof model === "string" ? model : model.id;
export function findModel(
  models: (Model | string)[] | undefined,
  id: string,
): Model | undefined {
  const match = models?.find((item) => modelId(item) === id);
  return typeof match === "string" ? { id: match } : match;
}
export function modelPatch(model: Model | undefined): Partial<CreativeData> {
  if (!model) return {};
  return {
    model: model.id,
    ...(model.caps?.fixedDuration
      ? { duration: model.caps.fixedDuration }
      : {}),
    ...(model.caps?.fixedWidth && model.caps?.fixedHeight
      ? { width: model.caps.fixedWidth, height: model.caps.fixedHeight }
      : {}),
  };
}
export function validateModel(
  model: Model | undefined,
  data: CreativeData,
  referenceCount: number,
) {
  if (!model || model.available === false)
    throw new Error("这个模型当前不可用，请检查流量池连接或选择其他模型。");
  if (model.caps?.supportsReferenceImages === false && referenceCount > 0)
    throw new Error(
      "当前模型不支持参考图。请移除图片连线和参考素材，或改用支持参考图的 Muse 模型。",
    );
  if (
    model.caps?.maxReferenceImages &&
    referenceCount > model.caps.maxReferenceImages
  )
    throw new Error(
      `当前模型最多支持 ${model.caps.maxReferenceImages} 张参考图。`,
    );
  if (
    data.kind === "video" &&
    model.caps?.fixedDuration &&
    (data.duration || 5) !== model.caps.fixedDuration
  )
    throw new Error(
      `当前模型的视频固定为 ${model.caps.fixedDuration} 秒，请重新选择模型以应用参数。`,
    );
  if (
    model.caps?.fixedWidth &&
    model.caps?.fixedHeight &&
    (data.width !== model.caps.fixedWidth ||
      data.height !== model.caps.fixedHeight)
  )
    throw new Error("当前模型使用固定分辨率，请重新选择模型以应用参数。");
}
