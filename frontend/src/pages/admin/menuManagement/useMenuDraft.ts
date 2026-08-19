import { useMemo, useState } from "react";
import type {
  ConflictPolicy,
  MenuImportCategoryDraft,
  MenuImportDraft,
  MenuImportProductDraft,
} from "../../../features/menu/menuApi";

/**
 * Whether a row would actually be sent by cleanForCommit: has a name and a
 * non-negative price, and isn't a still-SKIP conflict or an unresolved
 * ambiguous row. Shared with draftAfterCommit so the two never disagree
 * about which rows left the browser.
 */
function wasRowSent(p: MenuImportProductDraft): boolean {
  if (!p.name.trim() || p.price < 0) return false;
  if (p.ambiguous) return p.onConflict === "CREATE";
  if (p.existingProductId && (p.onConflict ?? "SKIP") === "SKIP") return false;
  return true;
}

/** Fold key the server also uses to echo a row back on `failures`. */
const rowKey = (categoryName: string, productName: string) =>
  `${categoryName.trim()}||${productName.trim()}`;

/**
 * Draft state for the review grid, lifted out of MenuImportTab so a link or
 * spreadsheet import can share it. Knows nothing about where the draft came
 * from — photos, a URL, or a file all produce the same shape.
 *
 * Two kinds of "this already exists" the server can send on a row:
 *  - an ORDINARY conflict: `existingProductId` set, `onConflict` defaults to
 *    "SKIP". The operator may switch it to UPDATE_PRICE or CREATE. Left on
 *    SKIP, it is a deliberate, completed choice — never sent, never
 *    revisited.
 *  - an AMBIGUOUS row: `ambiguous: true`, no `existingProductId` — the
 *    (category, name) matched more than one product already on the menu
 *    and the server refused to guess. It does nothing on commit unless the
 *    operator explicitly sets `onConflict: "CREATE"` ("add anyway"); any
 *    other value is refused server-side as a failure. Left unresolved, it
 *    is simply not sent — but unlike SKIP, it isn't a completed choice, so
 *    it comes back after a commit instead of vanishing.
 */
export function useMenuDraft() {
  const [draft, setDraft] = useState<MenuImportDraft | null>(null);

  const totalItems = useMemo(
    () => draft?.categories.reduce((n, c) => n + c.products.length, 0) ?? 0,
    [draft],
  );

  // Rows the commit endpoint would reject: blank product name or a negative
  // price, plus a blank category name over real rows.
  const invalidRowCount = useMemo(() => {
    if (!draft) return 0;
    return draft.categories.reduce((n, c) => {
      const badRows = c.products.filter((p) => !p.name.trim() || p.price < 0).length;
      const badCatName = !c.name.trim() && c.products.length > 0 ? 1 : 0;
      return n + badRows + badCatName;
    }, 0);
  }, [draft]);

  // Ordinary conflicts only — a row the server matched to exactly one
  // existing product. Ambiguous rows are counted separately below; they
  // don't carry existingProductId so they never double-count here.
  const conflictCount = useMemo(
    () =>
      draft?.categories.reduce(
        (n, c) => n + c.products.filter((p) => p.existingProductId).length,
        0,
      ) ?? 0,
    [draft],
  );

  // Rows that matched MORE than one existing product — the classic
  // already-doubled menu. Surfaced separately so the grid can render them
  // distinctly and explain that they do nothing by default.
  const ambiguousCount = useMemo(
    () =>
      draft?.categories.reduce(
        (n, c) => n + c.products.filter((p) => p.ambiguous).length,
        0,
      ) ?? 0,
    [draft],
  );

  /**
   * Rows cleanForCommit will hold back right now, split by why — so a
   * caller can report them instead of letting them vanish silently into a
   * "success" toast. Excludes invalid rows (blank name / negative price):
   * those block commit entirely before this ever matters.
   */
  const withheldCounts = useMemo(() => {
    if (!draft) return { skipped: 0, ambiguous: 0 };
    let skipped = 0;
    let ambiguous = 0;
    for (const c of draft.categories) {
      for (const p of c.products) {
        if (!p.name.trim() || p.price < 0) continue;
        if (wasRowSent(p)) continue;
        if (p.ambiguous) ambiguous++;
        else if (p.existingProductId) skipped++;
      }
    }
    return { skipped, ambiguous };
  }, [draft]);

  const updateProduct = (
    ci: number,
    pi: number,
    patch: Partial<MenuImportProductDraft>,
  ) =>
    setDraft((d) =>
      d
        ? {
            categories: d.categories.map((c, i) =>
              i !== ci
                ? c
                : { ...c, products: c.products.map((p, j) => (j !== pi ? p : { ...p, ...patch })) },
            ),
          }
        : d,
    );

  const updateCategoryName = (ci: number, name: string) =>
    setDraft((d) =>
      d ? { categories: d.categories.map((c, i) => (i === ci ? { ...c, name } : c)) } : d,
    );

  const removeProduct = (ci: number, pi: number) =>
    setDraft((d) =>
      d
        ? {
            categories: d.categories.map((c, i) =>
              i !== ci ? c : { ...c, products: c.products.filter((_, j) => j !== pi) },
            ),
          }
        : d,
    );

  const removeCategory = (ci: number) =>
    setDraft((d) => (d ? { categories: d.categories.filter((_, i) => i !== ci) } : d));

  const addProduct = (ci: number) =>
    setDraft((d) =>
      d
        ? {
            categories: d.categories.map((c, i) =>
              i !== ci ? c : { ...c, products: [...c.products, { name: "", price: 0 }] },
            ),
          }
        : d,
    );

  /** Apply one choice to every row that actually collided (ordinary conflicts only — an
   *  ambiguous row has no existingProductId and is resolved per-row, never in bulk). */
  const setAllConflictPolicy = (policy: ConflictPolicy) =>
    setDraft((d) =>
      d
        ? {
            categories: d.categories.map((c) => ({
              ...c,
              products: c.products.map((p) =>
                p.existingProductId ? { ...p, onConflict: policy } : p,
              ),
            })),
          }
        : d,
    );

  /**
   * What actually goes to the server: SKIP rows never leave the browser, an
   * ambiguous row the operator hasn't explicitly said "add anyway" to never
   * leaves either, and a category left with nothing is dropped. Names are
   * trimmed here — the server folds/echoes on the trimmed name too, and
   * draftAfterCommit's failure-matching depends on both sides agreeing.
   */
  const cleanForCommit = (): MenuImportDraft | null => {
    if (!draft) return null;
    return {
      categories: draft.categories
        .map((c) => ({
          name: c.name.trim(),
          products: c.products
            .filter(wasRowSent)
            .map((p) => ({ ...p, name: p.name.trim() })),
        }))
        .filter((c) => c.name && c.products.length),
    };
  };

  /**
   * What should remain in the draft after a commit attempt, given the
   * `failures` the server returned for what was actually sent:
   *  - every row the server reported as a failure, matched back by
   *    (category, trimmed name) — the same key it was sent under. If the
   *    server reported failures but NONE of them matched a sent row (a key
   *    mismatch that should never happen but would otherwise silently
   *    empty the draft), every row that was sent is kept instead — the
   *    same fallback BulkAddModal uses.
   *  - every ambiguous row that was never sent because it was still
   *    unresolved — it is exactly as undecided as before, so it comes
   *    back for the operator to resolve.
   *  - an ordinary SKIP conflict is NOT retained: SKIP is a deliberate,
   *    completed choice, not a pending one.
   *
   * Returns null when nothing is left to review.
   */
  const draftAfterCommit = (
    failures: { category: string; product: string }[],
  ): MenuImportDraft | null => {
    if (!draft) return null;
    const failedKeys = new Set(failures.map((f) => rowKey(f.category, f.product)));
    const isFailedRow = (c: MenuImportCategoryDraft, p: MenuImportProductDraft) =>
      wasRowSent(p) && failedKeys.has(rowKey(c.name, p.name));

    const matchedAny = draft.categories.some((c) => c.products.some((p) => isFailedRow(c, p)));
    const keepSentRow = (c: MenuImportCategoryDraft, p: MenuImportProductDraft) => {
      if (failures.length === 0) return false; // nothing sent needs to come back
      if (matchedAny) return isFailedRow(c, p); // keep exactly what failed
      return true; // unexplained mismatch — keep everything sent rather than lose it
    };

    const categories = draft.categories
      .map((c) => ({
        name: c.name.trim(),
        products: c.products.filter((p) =>
          wasRowSent(p)
            ? keepSentRow(c, p)
            : !!p.ambiguous && p.onConflict !== "CREATE",
        ),
      }))
      .filter((c) => c.products.length);

    return categories.length ? { categories } : null;
  };

  return {
    draft,
    setDraft,
    totalItems,
    invalidRowCount,
    conflictCount,
    ambiguousCount,
    withheldCounts,
    updateProduct,
    updateCategoryName,
    removeProduct,
    removeCategory,
    addProduct,
    setAllConflictPolicy,
    cleanForCommit,
    draftAfterCommit,
  };
}

export type MenuDraftControls = ReturnType<typeof useMenuDraft>;
