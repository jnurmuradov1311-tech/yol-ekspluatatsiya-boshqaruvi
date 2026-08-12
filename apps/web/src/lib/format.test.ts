import { describe, expect, it } from "vitest";
import { formatChainage, formatCount, formatDateTime } from "./format";

describe("Uzbek display formatters", () => {
  it("formats road chainage without losing metres", () => {
    expect(formatChainage(18420)).toBe("18+420");
    expect(formatChainage(7)).toBe("0+007");
  });

  it("uses a dash for missing timestamps", () => {
    expect(formatDateTime(null)).toBe("—");
  });

  it("formats count values for display", () => {
    expect(formatCount(1250)).toMatch(/1.250|1\s250|1,250/);
  });
});
