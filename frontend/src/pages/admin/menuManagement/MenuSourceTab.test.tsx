import { describe, it, expect, vi } from "vitest";
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
vi.mock("../../../components/subscriptions/FeatureGate", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe("MenuSourceTab", () => {
  it("refuses to submit an empty link", () => {
    render(<MenuSourceTab />);
    fireEvent.click(screen.getByTestId("source-submit"));
    expect(parseMutate).not.toHaveBeenCalled();
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
});
