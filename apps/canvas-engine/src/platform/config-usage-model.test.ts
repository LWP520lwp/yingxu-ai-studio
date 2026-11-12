import { describe, expect, it } from "vitest";

import {
  formatPoolRecordTime,
  formatStorageBytes,
  poolQuotaStatus,
  storageQuotaPercent,
  storageStoreLabelKey,
  validQuotaPercent,
} from "@/lib/config-usage-model";

describe("configuration usage presentation model", () => {
  it("formats storage amounts at unit boundaries and rejects invalid values", () => {
    expect(formatStorageBytes(0)).toBe("0 B");
    expect(formatStorageBytes(1024)).toBe("1.0 KB");
    expect(formatStorageBytes(1024 ** 2)).toBe("1.0 MB");
    expect(formatStorageBytes(1024 ** 3)).toBe("1.00 GB");
    expect(formatStorageBytes(null)).toBe("—");
    expect(formatStorageBytes(Number.NaN)).toBe("—");
    expect(formatStorageBytes(-1)).toBe("—");
  });

  it("clamps storage progress and distinguishes unavailable quota", () => {
    expect(storageQuotaPercent(40, 100)).toBe(40);
    expect(storageQuotaPercent(120, 100)).toBe(100);
    expect(storageQuotaPercent(40, 0)).toBeNull();
    expect(storageQuotaPercent(-1, 100)).toBeNull();
  });

  it("maps known stores while retaining unknown store names for display", () => {
    expect(storageStoreLabelKey("image_files")).toBe("images");
    expect(storageStoreLabelKey("custom_store")).toBeUndefined();
  });

  it("accepts only finite quota percentages in the supported range", () => {
    expect(validQuotaPercent(0)).toBe(0);
    expect(validQuotaPercent(100)).toBe(100);
    expect(validQuotaPercent(100.1)).toBeNull();
    expect(validQuotaPercent(Number.POSITIVE_INFINITY)).toBeNull();
    expect(validQuotaPercent("50")).toBeNull();
  });

  it("prioritizes cached state and handles invalid record timestamps", () => {
    expect(poolQuotaStatus(true, "available")).toEqual({
      label: "缓存待刷新",
      color: "gold",
    });
    expect(poolQuotaStatus(false, "available")).toEqual({
      label: "已同步",
      color: "green",
    });
    expect(poolQuotaStatus(false, "error").label).toBe("暂未同步");
    expect(formatPoolRecordTime(null)).toBe("尚未获取");
    expect(formatPoolRecordTime("not-a-date")).toBe("尚未获取");
    expect(formatPoolRecordTime("2026-11-11T02:05:00Z")).not.toBe("尚未获取");
  });
});
