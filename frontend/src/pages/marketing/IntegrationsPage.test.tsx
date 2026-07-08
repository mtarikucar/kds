import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import IntegrationsPage from "./IntegrationsPage";

describe("IntegrationsPage", () => {
  it("lists real integrations with honest statuses", () => {
    render(
      <MemoryRouter>
        <IntegrationsPage />
      </MemoryRouter>,
    );
    // Live delivery + accounting integrations
    for (const name of [
      "Yemeksepeti",
      "Getir",
      "Trendyol Yemek",
      "Migros Yemek",
      "Paraşüt",
      "Foriba",
      "PayTR",
    ]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    // ÖKC is honestly "yakında", never claimed live
    expect(screen.getByText("Hugin")).toBeInTheDocument();
    expect(screen.getAllByText("Yakında").length).toBeGreaterThanOrEqual(3);
    // "entegrasyon yoksa nasıl çalışır" blocks exist for every category
    expect(
      screen.getAllByText(/Entegrasyon yoksa:/).length,
    ).toBeGreaterThanOrEqual(6);
  });
});
