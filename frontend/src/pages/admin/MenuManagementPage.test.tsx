import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import MenuManagementPage from "./MenuManagementPage";

/**
 * Covers the one-dropdown/three-mode import modal added in task 10: mode
 * switching mounts the right tab, the importDirty guard confirms before an
 * Escape/backdrop close destroys unsaved work in ANY of the three modes
 * (not just the photo one), a clean tab closes without asking, and dirty
 * never leaks from one tab instance into the next.
 *
 * The three tabs (MenuImportTab, MenuSourceTab, BulkAddModalBody) are
 * replaced with controllable stubs — their own dirty-computation logic is
 * covered by MenuSourceTab.test.tsx and BulkAddModal.test.tsx respectively;
 * this file only needs to prove the PAGE wires onDirtyChange/onClose/onDone
 * correctly regardless of which tab is doing the reporting.
 */

const h = vi.hoisted(() => ({
  checkLimitAllowed: true,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, d?: any) => (typeof d === "string" ? d : d?.defaultValue ?? k),
  }),
}));

vi.mock("../../features/menu/menuApi", () => ({
  useCategories: () => ({ data: [], isLoading: false, isError: false, error: undefined, refetch: vi.fn() }),
  useProducts: () => ({ data: [], isLoading: false, isError: false, error: undefined, refetch: vi.fn() }),
  useCreateCategory: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateCategory: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteCategory: () => ({ mutate: vi.fn() }),
  useDeleteProduct: () => ({ mutate: vi.fn() }),
  useMenuImportStatus: () => ({ data: { configured: true } }),
}));

vi.mock("../../features/modifiers/modifiersApi", () => ({
  useModifierGroups: () => ({ data: [], isLoading: false }),
  useCreateModifierGroup: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateModifierGroup: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteModifierGroup: () => ({ mutate: vi.fn() }),
  useCreateModifier: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateModifier: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteModifier: () => ({ mutate: vi.fn() }),
}));

vi.mock("../../contexts/SubscriptionContext", () => {
  // useSubscription IS useEntitlements (an alias in the real module) — both
  // names are exercised here: the page calls useSubscription() directly,
  // UpgradePrompt (rendered when !canAddProduct, unmocked) calls
  // useEntitlements() for its own pricing copy.
  const impl = () => ({
    checkLimit: () => ({
      allowed: h.checkLimitAllowed,
      current: 0,
      limit: 100,
      remaining: h.checkLimitAllowed ? 100 : 0,
    }),
    offerFor: () => null,
    license: { status: "active", anchorAt: null, anniversaryAt: null, daysRemaining: null },
    hasFeature: () => true,
    hasIntegration: () => false,
    isLoading: false,
    credits: {},
    owned: [],
    renewal: null,
    snapshot: null,
  });
  return { useSubscription: impl, useEntitlements: impl };
});

vi.mock("../../components/modifiers", () => ({
  ModifierGroupModal: () => null,
  ModifierItemModal: () => null,
}));

vi.mock("../../components/ui/ErrorState", () => ({ ErrorState: () => null }));
vi.mock("./menuManagement/MenuTree", () => ({ default: () => <div data-testid="menu-tree" /> }));
vi.mock("./ProductEditorPage", () => ({ default: () => <div data-testid="product-editor" /> }));

vi.mock("./menuManagement/MenuImportTab", () => ({
  default: ({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) => (
    <div data-testid="tab-photo">
      photo-tab
      <button onClick={() => onDirtyChange?.(true)}>make photo dirty</button>
    </div>
  ),
}));
vi.mock("./menuManagement/MenuSourceTab", () => ({
  default: ({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) => (
    <div data-testid="tab-source">
      source-tab
      <button onClick={() => onDirtyChange?.(true)}>make source dirty</button>
    </div>
  ),
}));
vi.mock("../../components/product/BulkAddModal", () => ({
  BulkAddModalBody: ({
    onDone,
    onDirtyChange,
  }: {
    onDone?: () => void;
    onDirtyChange?: (dirty: boolean) => void;
  }) => (
    <div data-testid="tab-manual">
      manual-tab
      <button onClick={() => onDirtyChange?.(true)}>make manual dirty</button>
      <button onClick={() => onDone?.()}>finish manual</button>
    </div>
  ),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <MenuManagementPage />
    </MemoryRouter>,
  );
}

const openMode = (itemLabel: string) => {
  fireEvent.click(screen.getByText("Toplu ekle"));
  fireEvent.click(screen.getByText(itemLabel));
};

describe("MenuManagementPage — one dropdown, three import modes", () => {
  beforeEach(() => {
    h.checkLimitAllowed = true;
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("opening each mode mounts the matching tab and only that tab", () => {
    renderPage();

    openMode("Kaynak ver (link / PDF / Excel)");
    expect(screen.getByTestId("tab-source")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-photo")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tab-manual")).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" }); // clean close, not dirty

    openMode("Fotoğraftan menü");
    expect(screen.getByTestId("tab-photo")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-source")).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });

    openMode("Manuel toplu ekle");
    expect(screen.getByTestId("tab-manual")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-photo")).not.toBeInTheDocument();
  });

  it("a dirty tab confirms on Escape and STAYS OPEN when the operator declines", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();

    openMode("Kaynak ver (link / PDF / Excel)");
    fireEvent.click(screen.getByText("make source dirty"));
    fireEvent.keyDown(document, { key: "Escape" });

    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.getByTestId("tab-source")).toBeInTheDocument(); // still open
  });

  it("a dirty tab confirms on Escape and CLOSES when the operator accepts", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();

    openMode("Fotoğraftan menü");
    fireEvent.click(screen.getByText("make photo dirty"));
    fireEvent.keyDown(document, { key: "Escape" });

    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.queryByTestId("tab-photo")).not.toBeInTheDocument();
  });

  it("a clean tab closes on Escape WITHOUT ever calling confirm", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();

    openMode("Manuel toplu ekle");
    fireEvent.keyDown(document, { key: "Escape" });

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("tab-manual")).not.toBeInTheDocument();
  });

  it("dirty does not leak from a confirmed-closed tab into the next mode opened", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();

    openMode("Kaynak ver (link / PDF / Excel)");
    fireEvent.click(screen.getByText("make source dirty"));
    fireEvent.keyDown(document, { key: "Escape" }); // confirmed close, resets importDirty
    expect(confirmSpy).toHaveBeenCalledTimes(1);

    openMode("Fotoğraftan menü");
    fireEvent.keyDown(document, { key: "Escape" }); // must NOT still be "dirty" from source mode

    expect(confirmSpy).toHaveBeenCalledTimes(1); // no second call
    expect(screen.queryByTestId("tab-photo")).not.toBeInTheDocument();
  });

  it("manual mode's onDone (Cancel / finished commit) resets importDirty too, not just a confirmed Escape", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();

    openMode("Manuel toplu ekle");
    fireEvent.click(screen.getByText("make manual dirty"));
    fireEvent.click(screen.getByText("finish manual")); // onDone(), bypasses handleCloseImportModal entirely
    expect(screen.queryByTestId("tab-manual")).not.toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled(); // onDone never asks — that's correct, see below

    // The bug this guards against: onDone setting importMode(null) without
    // also resetting importDirty would leave the NEXT tab's Escape thinking
    // it's still dirty from the abandoned manual session.
    openMode("Fotoğraftan menü");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("the dropdown trigger and the two AI-backed options stay reachable at the product limit — only manual bulk-add and 'Yeni ürün' are gated by canAddProduct", () => {
    h.checkLimitAllowed = false;
    renderPage();

    const trigger = screen.getByText("Toplu ekle").closest("button")!;
    expect(trigger).not.toBeDisabled();

    fireEvent.click(trigger);
    expect(screen.getByText("Kaynak ver (link / PDF / Excel)").closest("button")).not.toBeDisabled();
    expect(screen.getByText("Fotoğraftan menü").closest("button")).not.toBeDisabled();
    expect(screen.getByText("Manuel toplu ekle").closest("button")).toBeDisabled();

    expect(screen.getByText("Yeni ürün").closest("button")).toBeDisabled();
  });
});
