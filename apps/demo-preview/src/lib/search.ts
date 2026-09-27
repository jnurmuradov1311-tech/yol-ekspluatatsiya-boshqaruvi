const letters: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya", ў: "o", қ: "q", ғ: "g", ҳ: "h" };

/** Search the same Uzbek words in either alphabet and common apostrophe forms. */
export function normalizeSearch(value: string): string {
  return value.toLocaleLowerCase("uz").replace(/[а-яёўқғҳ]/g, (letter) => letters[letter] ?? letter).normalize("NFKD").replace(/[\u0300-\u036f'’‘ʻʼ`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

export function matchesSearch(query: string, ...values: Array<string | undefined | null>): boolean {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  const haystack = normalizeSearch(values.filter(Boolean).join(" "));
  return words.every((word) => haystack.includes(word));
}
