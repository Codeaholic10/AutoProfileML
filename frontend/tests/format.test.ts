import { describe, expect, it } from "vitest";

import {
  formatBytes,
  formatCount,
  formatDateTime,
  formatDuration,
  formatMetric,
  formatPercent,
} from "@/lib/format";

describe("formatBytes", () => {
  it("uses bytes below 1 KB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("scales through binary units", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(200 * 1024 * 1024)).toBe("200 MB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3 GB");
  });

  it("returns a dash for unusable values", () => {
    expect(formatBytes(Number.NaN)).toBe("—");
    expect(formatBytes(-1)).toBe("—");
  });
});

describe("formatPercent", () => {
  it("formats an already-percentage value", () => {
    expect(formatPercent(12.3456)).toBe("12.3%");
    expect(formatPercent(12.3456, 2)).toBe("12.35%");
    expect(formatPercent(0)).toBe("0.0%");
  });

  it("returns a dash for non-finite values", () => {
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatCount", () => {
  it("adds thousands separators", () => {
    expect(formatCount(1234)).toBe("1,234");
    expect(formatCount(0)).toBe("0");
  });
});

describe("formatDateTime", () => {
  it("renders UTC timestamps", () => {
    expect(formatDateTime("2026-10-21T12:00:00Z")).toBe("2026-10-21 12:00 UTC");
  });

  it("converts other offsets to UTC", () => {
    expect(formatDateTime("2026-10-21T12:00:00+05:30")).toBe("2026-10-21 06:30 UTC");
  });

  it("returns a dash for invalid input", () => {
    expect(formatDateTime("not-a-date")).toBe("—");
  });
});

describe("formatDuration", () => {
  it("formats milliseconds", () => {
    expect(formatDuration(850)).toBe("850 ms");
  });

  it("formats seconds", () => {
    expect(formatDuration(1500)).toBe("1.50 s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(125_000)).toBe("2 min 5 s");
  });

  it("returns a dash for negative durations", () => {
    expect(formatDuration(-5)).toBe("—");
  });
});

describe("formatMetric", () => {
  it("keeps up to four decimals", () => {
    expect(formatMetric(0.91234)).toBe("0.9123");
    expect(formatMetric(1)).toBe("1");
    expect(formatMetric(1234.56789)).toBe("1,234.5679");
  });

  it("returns a dash for non-finite values", () => {
    expect(formatMetric(Number.NaN)).toBe("—");
  });
});
