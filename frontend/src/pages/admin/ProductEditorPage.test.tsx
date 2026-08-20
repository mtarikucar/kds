import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * Everything the full editor page pulls in (menu/modifiers data hooks,
 * heavy child panels) is stubbed so this file can isolate ONE thing: the
 * KDV/QQS taxRate <select> must offer the TENANT'S OWN country band, not a
 * hardcoded Turkish list — a UZ operator could otherwise never set the 12%
 * QQS rate the backend now accepts (@IsCountryTaxRate).
 */
const h = vi.hoisted(() => ({
  countryProfile: { countryCode: "TR", taxRates: [0, 1, 10, 20], defaultTaxRate: 10 },
}));

vi.mock("../../hooks/useCountryProfile", () => ({
  useCountryProfile: () => h.countryProfile,
}));

vi.mock("../../features/menu/menuApi", () => ({
  useCategories: () => ({ data: [] }),
  useProduct: () => ({ data: undefined }),
  useProducts: () => ({ data: [] }),
  useCreateProduct: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateProduct: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("../../features/modifiers/modifiersApi", () => ({
  useAssignModifiersToProduct: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("../../components/modifiers", () => ({
  ProductModifierSelector: () => <div data-testid="modifier-selector" />,
}));
vi.mock("../../components/product/ProductImageField", () => ({
  default: () => <div data-testid="image-field" />,
}));
vi.mock("../../components/product/Product3dPanel", () => ({
  default: () => <div data-testid="product-3d" />,
}));
vi.mock("../../components/product/ProductMediaPanel", () => ({
  default: () => <div data-testid="product-media" />,
}));
vi.mock("./menuManagement/ComboBuilder", () => ({
  default: () => <div data-testid="combo-builder" />,
}));
vi.mock("./menuManagement/CollectionMultiSelect", () => ({
  default: () => <div data-testid="collection-select" />,
}));

import ProductEditorPage from "./ProductEditorPage";

function renderPage() {
  return render(
    <MemoryRouter>
      <ProductEditorPage />
    </MemoryRouter>,
  );
}

function getTaxRateSelect(): HTMLSelectElement {
  return screen.getByTestId("tax-rate-select") as HTMLSelectElement;
}

describe("ProductEditorPage taxRate <select> is country-scoped", () => {
  beforeEach(() => {
    h.countryProfile = { countryCode: "TR", taxRates: [0, 1, 10, 20], defaultTaxRate: 10 };
  });

  it("offers exactly the Turkish band for a TR tenant", () => {
    renderPage();
    const values = within(getTaxRateSelect())
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual(["0", "1", "10", "20"]);
  });

  it("offers UZ's OWN band (0/6/12) for a UZ tenant — 12% QQS was unreachable before", () => {
    h.countryProfile = { countryCode: "UZ", taxRates: [0, 6, 12], defaultTaxRate: 12 };
    renderPage();
    const values = within(getTaxRateSelect())
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual(["0", "6", "12"]);
    expect(values).not.toContain("20");
  });

  it("defaults a new product's taxRate to the country's OWN default (UZ: 12, not Turkey's 10)", () => {
    h.countryProfile = { countryCode: "UZ", taxRates: [0, 6, 12], defaultTaxRate: 12 };
    renderPage();
    expect(getTaxRateSelect().value).toBe("12");
  });
});
