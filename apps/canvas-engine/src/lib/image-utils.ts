import i18n from "@/i18n";
import type { ReferenceImage } from "@/types/image";

const FALLBACK_IMAGE_SIZE = 1024;
const IMAGE_LOAD_TIMEOUT_MS = 3000;

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const exponent = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** Math.max(0, exponent);
  return `${value.toFixed(value >= 10 || exponent <= 0 ? 0 : 1)} ${["B", "KB", "MB", "GB"][Math.max(0, exponent)]}`;
}

export function formatDuration(milliseconds: number) {
  const total = Math.floor(
    Math.max(0, Number.isFinite(milliseconds) ? milliseconds : 0) / 1000,
  );
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes
    ? i18n.t("common.durationMinutes", {
        minutes,
        seconds: String(seconds).padStart(2, "0"),
      })
    : i18n.t("common.durationSeconds", { seconds });
}

function parseDataUrl(value: string) {
  const comma = value.indexOf(",");
  if (!value.startsWith("data:") || comma < 0) return null;
  const header = value.slice(5, comma);
  return {
    mimeType: header.split(";")[0] || "",
    base64: /;base64(?:;|$)/i.test(header),
    payload: value.slice(comma + 1),
  };
}

/** Count decoded bytes without treating ordinary signed URLs as inline images. */
export function getDataUrlByteSize(value: string) {
  const data = parseDataUrl(value);
  if (!data) return 0;
  if (!data.base64) {
    try {
      return new TextEncoder().encode(decodeURIComponent(data.payload))
        .byteLength;
    } catch {
      return 0;
    }
  }
  const encoded = data.payload.replace(/\s/g, "");
  if (!/^[a-zA-Z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1)
    return 0;
  return Math.max(0, Math.floor((encoded.replace(/=+$/, "").length * 3) / 4));
}

/** FileReader has a single completion path, including a cancelled read. */
export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    const finish = (value?: string) => {
      reader.onload = null;
      reader.onerror = null;
      reader.onabort = null;
      if (value !== undefined) resolve(value);
      else reject(new Error(i18n.t("common.imageReadFailed")));
    };
    reader.onload = () =>
      typeof reader.result === "string" ? finish(reader.result) : finish();
    reader.onerror = () => finish();
    reader.onabort = () => finish();
    try {
      reader.readAsDataURL(file);
    } catch {
      finish();
    }
  });
}

/** Metadata is best-effort for remote preview URLs; listeners and timeouts are retired together. */
export function readImageMeta(source: string) {
  const mimeType = parseDataUrl(source)?.mimeType || "image/png";
  return new Promise<{ width: number; height: number; mimeType: string }>(
    (resolve) => {
      const image = new Image();
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        image.onload = null;
        image.onerror = null;
        resolve({
          width:
            image.naturalWidth > 0 ? image.naturalWidth : FALLBACK_IMAGE_SIZE,
          height:
            image.naturalHeight > 0 ? image.naturalHeight : FALLBACK_IMAGE_SIZE,
          mimeType,
        });
      };
      const timer = setTimeout(finish, IMAGE_LOAD_TIMEOUT_MS);
      image.onload = finish;
      image.onerror = finish;
      try {
        image.src = source;
      } catch {
        finish();
      }
    },
  );
}

export function dataUrlToFile(image: ReferenceImage) {
  const data = parseDataUrl(image.dataUrl);
  if (!data) throw new Error(i18n.t("common.imageReadFailed"));
  let bytes: Uint8Array;
  try {
    if (data.base64) {
      const decoded = atob(data.payload.replace(/\s/g, ""));
      bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
    } else bytes = new TextEncoder().encode(decodeURIComponent(data.payload));
  } catch {
    throw new Error(i18n.t("common.imageReadFailed"));
  }
  return new File(
    [bytes as Uint8Array<ArrayBuffer>],
    image.name || "reference.png",
    { type: data.mimeType || image.type || "image/png" },
  );
}
