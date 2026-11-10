import path from "node:path";
import net from "node:net";
import { WorkerError } from "./errors.mjs";

export const SITES = Object.freeze({ muse: "https://muse.ai/", doubao: "https://www.doubao.com/chat/" });

export function accountId(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
    throw new WorkerError(400, "INVALID_ACCOUNT_ID", "账号 ID 必须为 UUID");
  return value.toLowerCase();
}

export function provider(value) {
  if (!Object.hasOwn(SITES, value)) throw new WorkerError(400, "INVALID_PROVIDER", "不支持此网页登录提供方");
  return value;
}

export function accountPath(root, id) {
  const target = path.resolve(root, accountId(id));
  if (path.dirname(target) !== path.resolve(root)) throw new WorkerError(400, "INVALID_ACCOUNT_PATH", "账号目录不在会话根目录");
  return target;
}

export function generationInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkerError(400, "INVALID_REQUEST", "生成输入必须为对象");
  const source = provider(body.provider);
  if (!["image", "video"].includes(body.kind)) throw new WorkerError(400, "INVALID_KIND", "生成类型必须为 image 或 video");
  if (typeof body.prompt !== "string" || !body.prompt.trim() || body.prompt.length > 12000)
    throw new WorkerError(400, "INVALID_PROMPT", "提示词不能为空，且不得超过 12000 字符");
  if (body.model !== undefined && body.model !== `${source}-${body.kind}`)
    throw new WorkerError(400, "INVALID_MODEL", "模型与提供方或生成类型不匹配");
  const dimension = (value) => value === undefined ? null : Number.isInteger(value) && value >= 128 && value <= 4096 ? value : NaN;
  const width = dimension(body.width), height = dimension(body.height);
  if (Number.isNaN(width) || Number.isNaN(height) || ((width === null) !== (height === null)))
    throw new WorkerError(400, "INVALID_DIMENSIONS", "宽高须同时提供，范围 128～4096");
  const duration = body.duration ?? 5;
  if (!Number.isInteger(duration) || duration < 1 || duration > 30)
    throw new WorkerError(400, "INVALID_DURATION", "请求时长须为 1～30 秒整数；网页实际输出需另行验证");
  const refs = body.referenceImages ?? [];
  if (!Array.isArray(refs) || refs.length > (body.kind === "video" ? 2 : 4))
    throw new WorkerError(400, "INVALID_REFERENCES", "参考图数量超出当前适配范围");
  const referenceImages = refs.map((value, index) => {
    if (typeof value !== "string") throw new WorkerError(400, "INVALID_REFERENCE", "参考图必须为图片 data URL");
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match || match[2].length > 6 * 1024 * 1024)
      throw new WorkerError(400, "INVALID_REFERENCE", "参考图须为不超过 4 MiB 的 PNG/JPEG/WebP data URL");
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length > 4 * 1024 * 1024 || mediaMime(bytes, "image") !== match[1])
      throw new WorkerError(400, "INVALID_REFERENCE", "参考图内容与声明类型不一致");
    return { name: `reference-${index}.${match[1].split("/")[1]}`, mimeType: match[1], buffer: bytes };
  });
  return { provider: source, kind: body.kind, prompt: body.prompt.trim(), width, height, duration, referenceImages };
}

export function mediaMime(bytes, kind) {
  let mime = null;
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mime = "image/png";
  else if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) mime = "image/jpeg";
  else if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") mime = "image/webp";
  else if (bytes.length >= 6 && /GIF8[79]a/.test(bytes.toString("ascii", 0, 6))) mime = "image/gif";
  else if (bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp") mime = "video/mp4";
  else if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]))) mime = "video/webm";
  if (!mime || !mime.startsWith(`${kind}/`)) throw new WorkerError(502, "INVALID_GENERATED_MEDIA", "网页结果不是预期的图片或视频文件");
  return mime;
}

export function mediaUrl(value, allowedHosts) {
  let url;
  try { url = new URL(value); } catch { throw new WorkerError(502, "INVALID_MEDIA_URL", "结果媒体地址无效"); }
  if (url.protocol === "blob:" && ["https://muse.ai", "https://www.muse.ai"].includes(url.origin)) return url.href;
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")
      || net.isIP(url.hostname.replace(/^\[|\]$/g, "")) || !allowedHosts.has(url.hostname.toLowerCase()))
    throw new WorkerError(502, "UNTRUSTED_MEDIA_HOST", "结果媒体来源尚未获信任，请由部署者核实并配置精确主机名");
  return url.href;
}
