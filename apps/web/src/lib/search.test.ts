import { describe, expect, it } from "vitest";
import { matchesSearch, normalizeSearch } from "./search";

describe("Uzbek search", () => {
  it("matches Latin and Cyrillic in both directions", () => {
    expect(matchesSearch("чуқур", "Qoplamadagi chuqurcha")).toBe(true);
    expect(matchesSearch("belgi", "Шикастланган йўл белгиси")).toBe(true);
    expect(matchesSearch("йўл белги", "Shikastlangan yo‘l belgisi")).toBe(true);
  });
  it("ignores case and apostrophe style and matches all query words", () => {
    expect(normalizeSearch("YO‘L YOʻL ЙЎЛ yo'l")).toBe("yol yol yol yol");
    expect(matchesSearch("D001 yoriq", "Qoplamadagi yoriq", "D001")).toBe(true);
    expect(matchesSearch("D002 yoriq", "Qoplamadagi yoriq", "D001")).toBe(false);
    expect(matchesSearch("  ", "Bekat")).toBe(true);
  });
});
