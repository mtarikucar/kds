import { CommitMenuImportDto } from "../dto/menu-import.dto";
import { foldMenuKey } from "./menu-key-fold";

export interface ColumnMap {
  name: string;
  price: string;
  category?: string;
  description?: string;
  taxRate?: string;
}

const PATTERNS: Record<keyof ColumnMap, RegExp> = {
  name: /^(ürün\s*ad[ıi]|urun\s*ad[ıi]|ürün|urun|ad[ıi]?|isim|name|item|product|title)$/i,
  price: /^(fiyat|tutar|ücret|ucret|price|amount|cost)$/i,
  category: /^(kategori|grup|bölüm|bolum|category|group|section)$/i,
  description: /^(açıklama|aciklama|detay|description|desc|details)$/i,
  taxRate: /^(kdv|vergi|tax|vat|kdv\s*oran[ıi]|tax\s*rate)$/i,
};

/**
 * Recognise the columns from their headers alone. Returns null when the two
 * required ones (name, price) are not both identifiable — the caller then
 * spends one small model call asking for the mapping instead of guessing.
 */
export function guessColumnMap(headers: string[]): ColumnMap | null {
  const found: Partial<ColumnMap> = {};
  for (const h of headers) {
    const key = h.trim();
    for (const field of Object.keys(PATTERNS) as (keyof ColumnMap)[]) {
      if (!found[field] && PATTERNS[field].test(key)) {
        found[field] = key;
        break;
      }
    }
  }
  if (!found.name || !found.price) return null;
  return found as ColumnMap;
}

/**
 * Turn a price cell into a number.
 *
 * Turkish sheets write 1.250,50 and English ones write 1,250.50 — the same
 * two characters mean the opposite thing. Decide by which separator appears
 * last: that one is the decimal point.
 */
export function parsePrice(raw: string): number {
  const s = (raw ?? "").replace(/[^\d.,-]/g, "").trim();
  if (!s) return 0;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let normalised: string;
  if (lastComma > lastDot) {
    normalised = s.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    normalised = s.replace(/,/g, "");
  } else {
    normalised = s;
  }
  const n = Number(normalised);
  return Number.isFinite(n) ? n : 0;
}

/** Our own CSV export prefixes ' to defuse formula injection; undo it here. */
function cleanCell(v: string | undefined): string {
  const s = (v ?? "").trim();
  return s.startsWith("'") ? s.slice(1) : s;
}

export function rowsToDraft(
  headers: string[],
  rows: string[][],
  map: ColumnMap,
): CommitMenuImportDto {
  const idx = (col?: string) =>
    col ? headers.findIndex((h) => h.trim() === col.trim()) : -1;
  const iName = idx(map.name);
  const iPrice = idx(map.price);
  const iCat = idx(map.category);
  const iDesc = idx(map.description);
  const iTax = idx(map.taxRate);

  const order: string[] = [];
  const buckets = new Map<string, { name: string; products: any[] }>();

  for (const row of rows) {
    const name = cleanCell(row[iName]);
    if (!name) continue;

    const catName = (iCat >= 0 ? cleanCell(row[iCat]) : "") || "Menü";
    const key = foldMenuKey(catName);
    if (!buckets.has(key)) {
      buckets.set(key, { name: catName, products: [] });
      order.push(key);
    }

    const taxRaw = iTax >= 0 ? parsePrice(row[iTax]) : NaN;
    buckets.get(key)!.products.push({
      name,
      description: iDesc >= 0 ? cleanCell(row[iDesc]) || undefined : undefined,
      price: parsePrice(row[iPrice]),
      taxRate: [0, 1, 10, 20].includes(taxRaw) ? taxRaw : undefined,
    });
  }

  return { categories: order.map((k) => buckets.get(k)!) } as CommitMenuImportDto;
}
