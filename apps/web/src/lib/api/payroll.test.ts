import { describe, expect, it } from "vitest";
import { payrollInputError } from "./payroll";
describe("payroll edits", () => {
  it("preserves intentional rate defaults and accepts coefficient plus distinct food and holiday pay", () => {
    expect(payrollInputError([{ workerId: "w1", coefficient: "1.25", mealAmountUzs: "250000.25", holidayAmountUzs: "100000", bonusRateBps: undefined }])).toBeNull();
  });
  it("rejects negative payments, excess rate, unsafe values and fractional tiyins", () => {
    for (const changes of [{ coefficient: 0 }, { coefficient: 11 }, { mealAmountUzs: "-1" }, { holidayAmountUzs: "0.001" }, { additionalRateBps: 20001 }, { bonusRateBps: NaN }]) expect(payrollInputError([{ workerId: "w1", ...changes }])).toBeTruthy();
  });
});
