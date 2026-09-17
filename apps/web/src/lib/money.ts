const grouping = new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 0 });
const decimalMark = new Intl.NumberFormat("uz-UZ").formatToParts(1.1).find((part) => part.type === "decimal")?.value ?? ",";

function cents(value: string): bigint {
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(value)) throw new Error("Pul summasi ikki kasr xonasigacha bo‘lishi kerak.");
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const amount = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
  return negative ? -amount : amount;
}
export function sumAmountUzs(values: string[]): string {
  const total = values.reduce((sum, value) => sum + cents(value), 0n);
  const magnitude = total < 0n ? -total : total;
  return `${total < 0n ? "-" : ""}${magnitude / 100n}.${String(magnitude % 100n).padStart(2, "0")}`;
}
export function formatAmountUzs(value: string): string {
  try {
    const amount = cents(value);
    const magnitude = amount < 0n ? -amount : amount;
    return `${amount < 0n ? "−" : ""}${grouping.format(magnitude / 100n)}${decimalMark}${String(magnitude % 100n).padStart(2, "0")}`;
  } catch {
    return value;
  }
}
