import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CorporatePage from "./CorporatePage";

describe("CorporatePage", () => {
  it("renders values, sister companies, and clearly-marked pending content", () => {
    render(
      <MemoryRouter>
        <CorporatePage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      /ekip/i,
    );
    // Sister companies present
    expect(screen.getByText("Efruze")).toBeInTheDocument();
    expect(screen.getByText("Figurinica")).toBeInTheDocument();
    // Pending content is explicitly labelled, not faked
    expect(screen.getAllByText(/yakında/i).length).toBeGreaterThanOrEqual(2);
    // Social responsibility section exists
    expect(screen.getAllByText(/Sosyal sorumluluk/i).length).toBeGreaterThan(0);
  });
});
