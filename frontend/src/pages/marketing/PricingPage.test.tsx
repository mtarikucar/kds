import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PricingPage from "./PricingPage";

describe("PricingPage", () => {
  it("shows the four plans with real, code-verified prices", () => {
    render(
      <MemoryRouter>
        <PricingPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      /planı seçin/i,
    );
    for (const name of ["Deneme", "Başlangıç", "Profesyonel", "Kurumsal"]) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(/499\s*₺/)).toBeInTheDocument();
    expect(screen.getByText(/1\.299\s*₺/)).toBeInTheDocument();
    expect(screen.getByText(/2\.999\s*₺/)).toBeInTheDocument();
    expect(screen.getAllByText("7 Gün Ücretsiz").length).toBeGreaterThan(0);
  });
});
