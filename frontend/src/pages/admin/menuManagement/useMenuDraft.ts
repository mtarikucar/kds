import { useMemo, useState } from "react";
import type {
  ConflictPolicy,
  MenuImportDraft,
} from "../../../features/menu/menuApi";

/**
 * Draft state for the review grid, lifted out of MenuImportTab so a link or
 * spreadsheet import can share it. Knows nothing about where the draft came
 * from — photos, a URL, or a file all produce the same shape.
 *
 * Two kinds of "this already exists" the server can send on a row:
 *  - an ORDINARY conflict: `existingProductId` set, `onConflict` defaults to
 *    "SKIP". The operator may switch it to UPDATE_PRICE or CREATE.
 *  - an AMBIGUOUS row: `ambiguous: true`, no `existingProductId` — the
 *    (category, name) matched more than one product already on the menu
 *    and the server refused to guess. It does nothing on commit unless the
 *    operator explicitly sets `onConflict: "CREATE"` ("add anyway"); any
 *    other value is refused server-side as a failure. Left unresolved, it
 *    is simply not sent — the same "do nothing" outcome, without wasting a
 *    failure row on something the operator never asked to happen.
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

  const updateProduct = (ci: number, pi: number, patch: Record<string, unknown>) =>
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
   * leaves either, and a category left with nothing is dropped.
   */
  const cleanForCommit = (): MenuImportDraft | null => {
    if (!draft) return null;
    return {
      categories: draft.categories
        .map((c) => ({
          name: c.name.trim(),
          products: c.products.filter((p) => {
            if (!p.name.trim() || p.price < 0) return false;
            if (p.ambiguous) return p.onConflict === "CREATE";
            if (p.existingProductId && (p.onConflict ?? "SKIP") === "SKIP") return false;
            return true;
          }),
        }))
        .filter((c) => c.name && c.products.length),
    };
  };

  return {
    draft,
    setDraft,
    totalItems,
    invalidRowCount,
    conflictCount,
    ambiguousCount,
    updateProduct,
    updateCategoryName,
    removeProduct,
    removeCategory,
    addProduct,
    setAllConflictPolicy,
    cleanForCommit,
  };
}

export type MenuDraftControls = ReturnType<typeof useMenuDraft>;
