import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BulkAddModalBody } from "./BulkAddModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, d?: any) => (typeof d === "string" ? d : d?.defaultValue ?? k),
  }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock("../../features/menu/menuApi", () => ({
  useCategories: () => ({
    data: [{ id: "cat-1", name: "İçecekler" }],
  }),
  useCommitMenuImport: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

describe("BulkAddModalBody dirty guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not arm the dirty guard from addRow()'s pre-seeded category alone", () => {
    const onDirtyChange = vi.fn();
    render(<BulkAddModalBody onDirtyChange={onDirtyChange} />);
    onDirtyChange.mockClear(); // drop the initial mount effect call (dirty=false)

    // "Satır ekle" appends a row pre-seeded with categories[0].id — clicking
    // it with zero typing must NOT look like the operator entered data.
    fireEvent.click(screen.getByText("Satır ekle"));

    expect(onDirtyChange).not.toHaveBeenCalledWith(true);
  });

  it("arms the dirty guard once the operator actually types a name", () => {
    const onDirtyChange = vi.fn();
    render(<BulkAddModalBody onDirtyChange={onDirtyChange} />);
    onDirtyChange.mockClear();

    const nameInputs = screen.getAllByPlaceholderText("Ürün adı");
    fireEvent.change(nameInputs[0], { target: { value: "Ayran" } });

    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });

  it("arms the dirty guard when the operator types a price, even with no name", () => {
    const onDirtyChange = vi.fn();
    render(<BulkAddModalBody onDirtyChange={onDirtyChange} />);
    onDirtyChange.mockClear();

    const priceInputs = screen.getAllByPlaceholderText("₺");
    fireEvent.change(priceInputs[0], { target: { value: "25" } });

    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });

  it("Cancel calls onDone regardless of dirty state — the page's Escape/backdrop guard is what needs confirmation, not an explicit Cancel click", () => {
    const onDone = vi.fn();
    render(<BulkAddModalBody onDone={onDone} />);

    const nameInputs = screen.getAllByPlaceholderText("Ürün adı");
    fireEvent.change(nameInputs[0], { target: { value: "Ayran" } });

    fireEvent.click(screen.getByText("İptal"));
    expect(onDone).toHaveBeenCalled();
  });
});
