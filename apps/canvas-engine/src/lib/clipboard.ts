export type ClipboardPort = {
  writeText?: (value: string) => Promise<void>;
  fallback: (value: string) => boolean | Promise<boolean>;
};

export async function copyTextWithFallback(
  value: string,
  port: ClipboardPort,
): Promise<boolean> {
  if (!value) return false;
  if (port.writeText) {
    try {
      await port.writeText(value);
      return true;
    } catch {
      // Older or restricted browser contexts may reject clipboard writes.
    }
  }
  try {
    return await port.fallback(value);
  } catch {
    return false;
  }
}
