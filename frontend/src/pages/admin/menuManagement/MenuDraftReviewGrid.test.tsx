import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MenuDraftReviewGrid from "./MenuDraftReviewGrid";
import { useMenuDraft } from "./useMenuDraft";
import { renderHook, act } from "@testing-library/react";

// Interpolates {{var}} against whichever argument carries the values —
// this codebase calls t() both as t(key, optionsWithDefaultValue) and as
// t(key, defaultValueString, options). A mock that ignores interpolation
// entirely lets an assertion pass for the wrong reason (a literal
// "{{p}}" happens to satisfy a loose text match) instead of proving the
// label actually renders the value.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, defaultValueOrOptions?: any, maybeOptions?: any) => {
      const hasStringDefault = typeof defaultValueOrOptions === "string";
      const template = hasStringDefault ? defaultValueOrOptions : (defaultValueOrOptions?.defaultValue ?? key);
      const values = hasStringDefault ? maybeOptions : defaultValueOrOptions;
      if (typeof template !== "string" || !values) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => String(values[name] ?? ""));
    },
  }),
}));

describe("useMenuDraft", () => {
  it("counts conflicting rows separately from invalid ones", () => {
    const { result } = renderHook(() => useMenuDraft());
    act(() =>
      result.current.setDraft({
        categories: [
          {
            name: "İçecekler",
            products: [
              { name: "Ayran", price: 25, existingProductId: "p1", onConflict: "SKIP" },
              { name: "", price: 30 },
            ],
          },
        ],
      }),
    );
    expect(result.current.conflictCount).toBe(1);
    expect(result.current.invalidRowCount).toBe(1);
    expect(result.current.totalItems).toBe(2);
  });

  it("setAllConflictPolicy rewrites only the conflicting rows", () => {
    const { result } = renderHook(() => useMenuDraft());
    act(() =>
      result.current.setDraft({
        categories: [
          {
            name: "X",
            products: [
              { name: "A", price: 1, existingProductId: "p1", onConflict: "SKIP" },
              { name: "B", price: 2 },
            ],
          },
        ],
      }),
    );
    act(() => result.current.setAllConflictPolicy("UPDATE_PRICE"));
    expect(result.current.draft!.categories[0].products[0].onConflict).toBe("UPDATE_PRICE");
    expect(result.current.draft!.categories[0].products[1].onConflict).toBeUndefined();
  });

  it("cleanForCommit drops SKIP rows and empty categories", () => {
    const { result } = renderHook(() => useMenuDraft());
    act(() =>
      result.current.setDraft({
        categories: [
          { name: "X", products: [{ name: "A", price: 1, existingProductId: "p1", onConflict: "SKIP" }] },
          { name: "Y", products: [{ name: "B", price: 2 }] },
        ],
      }),
    );
    const cleaned = result.current.cleanForCommit();
    expect(cleaned!.categories.map((c) => c.name)).toEqual(["Y"]);
  });

  it("counts ambiguous rows separately from ordinary conflicts", () => {
    const { result } = renderHook(() => useMenuDraft());
    act(() =>
      result.current.setDraft({
        categories: [
          {
            name: "X",
            products: [
              { name: "A", price: 1, existingProductId: "p1", onConflict: "SKIP" },
              { name: "B", price: 2, ambiguous: true },
            ],
          },
        ],
      }),
    );
    expect(result.current.conflictCount).toBe(1);
    expect(result.current.ambiguousCount).toBe(1);
  });

  it("cleanForCommit drops an unresolved ambiguous row but keeps it once set to CREATE", () => {
    const { result } = renderHook(() => useMenuDraft());
    act(() =>
      result.current.setDraft({
        categories: [
          {
            name: "X",
            products: [
              { name: "A", price: 1, ambiguous: true },
              { name: "B", price: 2, ambiguous: true, onConflict: "CREATE" },
            ],
          },
        ],
      }),
    );
    const cleaned = result.current.cleanForCommit();
    expect(cleaned!.categories[0].products.map((p) => p.name)).toEqual(["B"]);
  });

  it("cleanForCommit trims product names, so the server sees the same key draftAfterCommit will match on", () => {
    const { result } = renderHook(() => useMenuDraft());
    act(() =>
      result.current.setDraft({
        categories: [{ name: " X ", products: [{ name: " Ayran ", price: 25 }] }],
      }),
    );
    const cleaned = result.current.cleanForCommit();
    expect(cleaned!.categories[0].name).toBe("X");
    expect(cleaned!.categories[0].products[0].name).toBe("Ayran");
  });

  it("withheldCounts reports SKIP and unresolved-ambiguous rows separately", () => {
    const { result } = renderHook(() => useMenuDraft());
    act(() =>
      result.current.setDraft({
        categories: [
          {
            name: "X",
            products: [
              { name: "A", price: 1, existingProductId: "p1", onConflict: "SKIP" },
              { name: "B", price: 2, ambiguous: true },
              { name: "C", price: 3, ambiguous: true, onConflict: "CREATE" },
              { name: "D", price: 4 },
            ],
          },
        ],
      }),
    );
    expect(result.current.withheldCounts).toEqual({ skipped: 1, ambiguous: 1 });
  });

  it("draftAfterCommit returns null after a clean commit with nothing withheld", () => {
    const { result } = renderHook(() => useMenuDraft());
    act(() =>
      result.current.setDraft({
        categories: [{ name: "X", products: [{ name: "A", price: 1 }] }],
      }),
    );
    expect(result.current.draftAfterCommit([])).toBeNull();
  });

  it("draftAfterCommit retains an unresolved ambiguous row after a clean commit, drops the sent row", () => {
    const { result } = renderHook(() => useMenuDraft());
    act(() =>
      result.current.setDraft({
        categories: [
          {
            name: "X",
            products: [
              { name: "A", price: 1 },
              { name: "B", price: 2, ambiguous: true },
            ],
          },
        ],
      }),
    );
    const remaining = result.current.draftAfterCommit([]);
    expect(remaining!.categories[0].products.map((p) => p.name)).toEqual(["B"]);
  });

  it("draftAfterCommit matches a server failure by trimmed name, even when the draft row has padding", () => {
    const { result } = renderHook(() => useMenuDraft());
    act(() =>
      result.current.setDraft({
        categories: [{ name: "X", products: [{ name: " Ayran ", price: 1 }] }],
      }),
    );
    const remaining = result.current.draftAfterCommit([{ category: "X", product: "Ayran" }]);
    expect(remaining!.categories[0].products).toHaveLength(1);
  });

  it("draftAfterCommit falls back to every sent row instead of emptying the draft on a key mismatch", () => {
    const { result } = renderHook(() => useMenuDraft());
    act(() =>
      result.current.setDraft({
        categories: [
          {
            name: "X",
            products: [
              { name: "A", price: 1 },
              { name: "B", price: 2 },
            ],
          },
        ],
      }),
    );
    // Reports a failure but under a key that matches nothing in the draft.
    const remaining = result.current.draftAfterCommit([
      { category: "does-not-exist", product: "nor-this" },
    ]);
    expect(remaining!.categories[0].products.map((p) => p.name)).toEqual(["A", "B"]);
  });
});

describe("MenuDraftReviewGrid", () => {
  const controls = {
    draft: {
      categories: [
        {
          name: "İçecekler",
          products: [{ name: "Ayran", price: 25, existingProductId: "p1", existingPrice: 20, onConflict: "SKIP" as const }],
        },
      ],
    },
    totalItems: 1,
    invalidRowCount: 0,
    conflictCount: 1,
    ambiguousCount: 0,
    updateProduct: vi.fn(),
    updateCategoryName: vi.fn(),
    removeProduct: vi.fn(),
    removeCategory: vi.fn(),
    addProduct: vi.fn(),
    setAllConflictPolicy: vi.fn(),
  };

  it("shows the bulk conflict selector when there are conflicts", () => {
    render(<MenuDraftReviewGrid controls={controls as any} onCommit={vi.fn()} onCancel={vi.fn()} isCommitting={false} />);
    expect(screen.getByTestId("conflict-bulk")).toBeInTheDocument();
  });

  it("applies the bulk choice to every conflicting row", () => {
    render(<MenuDraftReviewGrid controls={controls as any} onCommit={vi.fn()} onCancel={vi.fn()} isCommitting={false} />);
    fireEvent.change(screen.getByTestId("conflict-bulk"), { target: { value: "UPDATE_PRICE" } });
    expect(controls.setAllConflictPolicy).toHaveBeenCalledWith("UPDATE_PRICE");
  });

  it("surfaces the existing price on a conflicting row", () => {
    render(<MenuDraftReviewGrid controls={controls as any} onCommit={vi.fn()} onCancel={vi.fn()} isCommitting={false} />);
    // Assert via the dedicated testid, not a loose /20/ text match — the
    // %20 tax-rate <option> would satisfy that regex even if this label
    // were deleted entirely.
    expect(screen.getByTestId("existing-price-0-0")).toHaveTextContent("20");
  });

  const ambiguousControls = {
    draft: {
      categories: [
        {
          name: "İçecekler",
          products: [{ name: "Ayran", price: 25, ambiguous: true as const }],
        },
      ],
    },
    totalItems: 1,
    invalidRowCount: 0,
    conflictCount: 0,
    ambiguousCount: 1,
    updateProduct: vi.fn(),
    updateCategoryName: vi.fn(),
    removeProduct: vi.fn(),
    removeCategory: vi.fn(),
    addProduct: vi.fn(),
    setAllConflictPolicy: vi.fn(),
  };

  it("renders an ambiguous row distinctly, without the ordinary-conflict bulk selector", () => {
    render(<MenuDraftReviewGrid controls={ambiguousControls as any} onCommit={vi.fn()} onCancel={vi.fn()} isCommitting={false} />);
    expect(screen.getByTestId("ambiguous-row-0-0")).toBeInTheDocument();
    expect(screen.queryByTestId("conflict-bulk")).not.toBeInTheDocument();
  });

  it("does nothing to an ambiguous row until 'add anyway' is chosen", () => {
    render(<MenuDraftReviewGrid controls={ambiguousControls as any} onCommit={vi.fn()} onCancel={vi.fn()} isCommitting={false} />);
    fireEvent.click(screen.getByTestId("ambiguous-toggle-0-0"));
    expect(ambiguousControls.updateProduct).toHaveBeenCalledWith(0, 0, { onConflict: "CREATE" });
  });
});
