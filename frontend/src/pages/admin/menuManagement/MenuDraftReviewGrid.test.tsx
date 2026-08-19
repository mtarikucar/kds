import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MenuDraftReviewGrid from "./MenuDraftReviewGrid";
import { useMenuDraft } from "./useMenuDraft";
import { renderHook, act } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, d?: any) => (typeof d === "string" ? d : d?.defaultValue ?? k),
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
    expect(screen.getByText(/20/)).toBeInTheDocument();
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
