import { describe, expect, it } from "vitest";
import { modelPatch, validateModel } from "./models";
import type { CreativeData, Model } from "./types";

const model: Model = {
  id: "doubao-video",
  available: true,
  caps: {
    supportsReferenceImages: false,
    fixedDuration: 10,
    fixedWidth: 1280,
    fixedHeight: 720,
  },
};
const node: CreativeData = {
  kind: "video",
  title: "镜头",
  prompt: "森林里的阳光",
  width: 1024,
  height: 1024,
  duration: 5,
};
describe("生成能力约束", () => {
  it("切换豆包时应用固定参数，并拒绝原有图片连线", () => {
    const next = { ...node, ...modelPatch(model) };
    expect(next).toMatchObject({
      model: "doubao-video",
      duration: 10,
      width: 1280,
      height: 720,
    });
    expect(() => validateModel(model, next, 0)).not.toThrow();
    expect(() => validateModel(model, next, 1)).toThrow("不支持参考图");
  });
  it("旧画布不应悄悄提交不兼容的参数", () => {
    expect(() => validateModel(model, node, 0)).toThrow("固定为 10 秒");
    expect(() =>
      validateModel({ id: "muse-video", available: false }, node, 0),
    ).toThrow("不可用");
    expect(() => validateModel(undefined, node, 0)).toThrow("不可用");
  });
});
