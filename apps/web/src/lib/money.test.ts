import { describe, expect, it } from "vitest";
import { formatAmountUzs, sumAmountUzs } from "./money";
describe("exact monetary display", () => {
  it("preserves every tiyin above Number safe integer range", () => {
    expect(sumAmountUzs(["999999999999999999.99", "0.01"])).toBe("1000000000000000000.00");
    expect(formatAmountUzs("999999999999999999.99").replace(/\D/g, "")).toBe("99999999999999999999");
  });
  it("sums separately rounded statement amounts without floating point drift", () => {
    expect(sumAmountUzs(["0.10", "0.20", "-0.01"])).toBe("0.29");
    expect(sumAmountUzs([])).toBe("0.00");
  });
});
