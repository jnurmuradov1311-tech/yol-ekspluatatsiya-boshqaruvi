const uzDateTime = new Intl.DateTimeFormat("uz-UZ", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Tashkent",
});

const uzDate = new Intl.DateTimeFormat("uz-UZ", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Tashkent",
});

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : uzDateTime.format(parsed);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : uzDate.format(parsed);
}

export function formatChainage(metres: number): string {
  const km = Math.floor(metres / 1000);
  const remainder = Math.round(metres % 1000).toString().padStart(3, "0");
  return `${km}+${remainder}`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("uz-UZ").format(value);
}
