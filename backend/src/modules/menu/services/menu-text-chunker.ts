import { CommitMenuImportDto } from "../dto/menu-import.dto";
import { foldMenuKey } from "./menu-key-fold";

/**
 * The Claude call is capped at max_tokens 8000. A whole restaurant website or
 * a twelve-page PDF blows past that and the JSON comes back truncated, which
 * surfaces to the operator as a generic "menu could not be read".
 *
 * So split first. Splitting happens on line boundaries — never mid-line —
 * and consecutive chunks share their last few lines, because a category
 * heading landing exactly on a boundary would otherwise leave the products
 * beneath it with no heading to belong to. The overlap costs a few duplicate
 * products, which mergeDrafts removes.
 *
 * The chunk ceiling is a refusal, not a truncation: importing half a menu
 * silently is worse than saying the source is too long.
 */
export function chunkMenuText(
  text: string,
  opts: { maxChars?: number; overlapLines?: number; maxChunks?: number } = {},
): string[] {
  const maxChars = opts.maxChars ?? 24_000;
  const overlapLines = opts.overlapLines ?? 15;
  const maxChunks = opts.maxChunks ?? 6;

  if (text.length <= maxChars) return [text];

  const lines = text.split("\n");
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;

  for (const line of lines) {
    if (size + line.length + 1 > maxChars && current.length) {
      chunks.push(current.join("\n"));
      if (chunks.length >= maxChunks) throw new Error("source too long");
      const tail = overlapLines > 0 ? current.slice(-overlapLines) : [];
      current = [...tail];
      // The carried-over tail is bonus context, not new content — it does not
      // eat into the next chunk's char budget, or the overlap itself would
      // shrink how much new material fits per chunk and inflate the chunk
      // count out of proportion to the source's actual size.
      size = 0;
    }
    current.push(line);
    size += line.length + 1;
  }
  if (current.length) chunks.push(current.join("\n"));
  if (chunks.length > maxChunks) throw new Error("source too long");
  return chunks;
}

/**
 * Fold per-chunk drafts into one. Categories match case-insensitively on the
 * trimmed name (the first spelling seen wins, so the menu keeps the source's
 * own capitalisation), and a product already present under that category is
 * dropped — that is how the chunk overlap stops being visible.
 */
export function mergeDrafts(
  drafts: CommitMenuImportDto[],
): CommitMenuImportDto {
  const order: string[] = [];
  const byKey = new Map<
    string,
    { name: string; products: any[]; seen: Set<string> }
  >();

  for (const draft of drafts) {
    for (const cat of draft.categories ?? []) {
      const key = foldMenuKey(cat.name ?? "");
      let bucket = byKey.get(key);
      if (!bucket) {
        bucket = {
          name: (cat.name ?? "").trim(),
          products: [],
          seen: new Set(),
        };
        byKey.set(key, bucket);
        order.push(key);
      }
      for (const p of cat.products ?? []) {
        const pk = foldMenuKey(p.name ?? "");
        if (!pk || bucket.seen.has(pk)) continue;
        bucket.seen.add(pk);
        bucket.products.push(p);
      }
    }
  }

  return {
    categories: order.map((k) => {
      const b = byKey.get(k)!;
      return { name: b.name, products: b.products };
    }),
  } as CommitMenuImportDto;
}
