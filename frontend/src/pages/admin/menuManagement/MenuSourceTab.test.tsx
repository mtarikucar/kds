import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MenuSourceTab from "./MenuSourceTab";

const parseMutate = vi.fn();
vi.mock("../../../features/menu/menuApi", () => ({
  useParseMenuSource: () => ({ mutateAsync: parseMutate, isPending: false }),
  useCommitMenuImport: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, d?: any) => (typeof d === "string" ? d : d?.defaultValue ?? k),
  }),
}));
const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn(), warning: vi.fn() } }));

function makeFile(name: string, type: string, sizeBytes: number): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: sizeBytes });
  return file;
}

describe("MenuSourceTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the source form ungated — a recognised CSV/XLSX never calls the model, so no AI-entitlement gate should hide it", () => {
    // Deliberately renders with NO subscription/entitlement mocking at all:
    // if step 1 were still wrapped in FeatureGate, this would blow up
    // reaching into SubscriptionContext instead of rendering the form.
    render(<MenuSourceTab />);
    expect(screen.getByTestId("source-url")).toBeInTheDocument();
    expect(screen.getByTestId("source-file")).toBeInTheDocument();
    expect(screen.getByTestId("source-submit")).toBeInTheDocument();
  });

  it("disables submit until a link or a file is provided", () => {
    render(<MenuSourceTab />);
    expect(screen.getByTestId("source-submit")).toBeDisabled();
    fireEvent.change(screen.getByTestId("source-url"), {
      target: { value: "https://restoran.com/menu" },
    });
    expect(screen.getByTestId("source-submit")).not.toBeDisabled();
  });

  it("sends the pasted link", async () => {
    parseMutate.mockResolvedValue({ categories: [] });
    render(<MenuSourceTab />);
    fireEvent.change(screen.getByTestId("source-url"), {
      target: { value: "https://restoran.com/menu" },
    });
    fireEvent.click(screen.getByTestId("source-submit"));
    expect(parseMutate).toHaveBeenCalledWith({ url: "https://restoran.com/menu", file: undefined });
  });

  it("sends the selected file", async () => {
    parseMutate.mockResolvedValue({ categories: [] });
    render(<MenuSourceTab />);
    const file = makeFile("menu.pdf", "application/pdf", 1024);
    fireEvent.change(screen.getByTestId("source-file"), { target: { files: [file] } });
    fireEvent.click(screen.getByTestId("source-submit"));
    expect(parseMutate).toHaveBeenCalledWith({ url: undefined, file });
  });

  it("rejects a file over the 10MB cap without ever calling the mutation", () => {
    render(<MenuSourceTab />);
    const big = makeFile("menu.pdf", "application/pdf", 11 * 1024 * 1024);
    fireEvent.change(screen.getByTestId("source-file"), { target: { files: [big] } });
    expect(toastError).toHaveBeenCalled();
    // Rejected, not merely un-set: submit must still be disabled (no url either).
    expect(screen.getByTestId("source-submit")).toBeDisabled();
    fireEvent.click(screen.getByTestId("source-submit"));
    expect(parseMutate).not.toHaveBeenCalled();
  });

  it("accepts a file right at the 10MB cap", () => {
    render(<MenuSourceTab />);
    const atCap = makeFile("menu.pdf", "application/pdf", 10 * 1024 * 1024);
    fireEvent.change(screen.getByTestId("source-file"), { target: { files: [atCap] } });
    expect(toastError).not.toHaveBeenCalled();
    expect(screen.getByTestId("source-submit")).not.toBeDisabled();
  });
});
