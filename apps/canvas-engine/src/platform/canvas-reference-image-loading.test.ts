import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ image: vi.fn(), metadata: vi.fn() }));
vi.mock("@/services/image-storage", () => ({ imageToDataUrl: reads.image }));
vi.mock("@/lib/image-utils", () => ({
  readImageMeta: reads.metadata,
  getDataUrlByteSize: () => 1,
}));

import {
  resolveCanvasReferenceImages,
  type CanvasResourceReference,
} from "@/atlas-engine/model/resource-references";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const reference = (id: string): CanvasResourceReference => ({
  id,
  nodeId: id,
  kind: "image",
  label: id,
  title: id,
  active: true,
  previewUrl: id,
});
const image = (
  id: string,
  metadata: CanvasNodeData["metadata"] = {},
): CanvasNodeData => ({
  id,
  type: CanvasNodeType.Image,
  title: id,
  position: { x: 0, y: 0 },
  width: 200,
  height: 120,
  metadata: { naturalWidth: 1920, naturalHeight: 1080, ...metadata },
});

beforeEach(() => {
  reads.image.mockReset();
  reads.metadata
    .mockReset()
    .mockResolvedValue({ width: 1200, height: 800, mimeType: "image/png" });
});

describe("reference image loading", () => {
  it("bounds concurrent decodes and retains user reference order despite out-of-order completion", async () => {
    const ids = Array.from({ length: 9 }, (_, index) => String(index));
    const pending = new Map<string, () => void>();
    let active = 0;
    let maximum = 0;
    reads.image.mockImplementation(
      ({ url }: { url: string }) =>
        new Promise<string>((resolve) => {
          active++;
          maximum = Math.max(maximum, active);
          pending.set(url, () => {
            active--;
            resolve(`data:image/png;base64,${url}`);
          });
        }),
    );
    const loading = resolveCanvasReferenceImages(
      ids.map(reference),
      ids.map((id) => image(id)),
    );
    expect(reads.image).toHaveBeenCalledTimes(4);
    for (const id of ["3", "2", "1", "0", "7", "6", "5", "4", "8"]) {
      await vi.waitFor(() => expect(pending.has(id)).toBe(true));
      pending.get(id)!();
    }
    const result = await loading;
    expect(maximum).toBe(4);
    expect(result.map(({ id }) => id)).toEqual(ids.map((id) => `canvas:${id}`));
    expect(reads.metadata).not.toHaveBeenCalled();
  });

  it("validates missing resources before fetching and uses the canonical imported record", async () => {
    await expect(
      resolveCanvasReferenceImages(
        [reference("ok"), reference("gone")],
        [image("ok")],
      ),
    ).rejects.toThrow();
    expect(reads.image).not.toHaveBeenCalled();
    reads.image.mockResolvedValue("data:image/webp;base64,AA==");
    const result = await resolveCanvasReferenceImages(
      [reference("ok")],
      [image("ok"), image("ok", { naturalWidth: 2, naturalHeight: 2 })],
    );
    expect(result[0]).toMatchObject({
      width: 1920,
      height: 1080,
      type: "image/webp",
    });
  });

  it("re-reads invalid saved dimensions and does not continue a cancelled selection", async () => {
    reads.image.mockResolvedValue("data:image/png;base64,AA==");
    const result = await resolveCanvasReferenceImages(
      [reference("bad-size")],
      [image("bad-size", { naturalWidth: -1, bytes: Number.NaN })],
    );
    expect(result[0]).toMatchObject({ width: 1200, height: 800, size: 1 });
    expect(reads.metadata).toHaveBeenCalledTimes(1);

    const controller = new AbortController();
    controller.abort();
    reads.image.mockClear();
    await expect(
      resolveCanvasReferenceImages(
        [reference("cancelled")],
        [image("cancelled")],
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(reads.image).not.toHaveBeenCalled();
  });

  it("stops dequeuing further images after a failed decode", async () => {
    const ids = ["0", "1", "2", "3", "4", "5"];
    reads.image.mockRejectedValue(new Error("unreadable image"));
    await expect(
      resolveCanvasReferenceImages(
        ids.map(reference),
        ids.map((id) => image(id)),
      ),
    ).rejects.toThrow("unreadable image");
    expect(reads.image).toHaveBeenCalledTimes(4);
  });
});
