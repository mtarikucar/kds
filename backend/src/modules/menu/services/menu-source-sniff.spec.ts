import { sniffSourceKind } from "./menu-source-sniff";

describe("sniffSourceKind", () => {
  const pdf = Buffer.from("%PDF-1.7\nrest");
  const xlsx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);
  const csv = Buffer.from("Ad;Fiyat\nAyran;25\n");
  const html = Buffer.from("<!doctype html><html><body>menu</body></html>");

  it("magic bytes beat a lying Content-Type", () => {
    expect(sniffSourceKind(pdf, "application/octet-stream")).toBe("pdf");
    expect(sniffSourceKind(pdf, "text/html")).toBe("pdf");
    expect(sniffSourceKind(xlsx, "application/octet-stream")).toBe("xlsx");
  });

  it("falls back to Content-Type when there are no magic bytes", () => {
    expect(sniffSourceKind(csv, "text/csv")).toBe("csv");
    expect(sniffSourceKind(csv, "text/csv; charset=utf-8")).toBe("csv");
  });

  it("falls back to the filename extension when the header is useless", () => {
    expect(sniffSourceKind(csv, "application/octet-stream", "menu.csv")).toBe("csv");
    expect(sniffSourceKind(pdf, undefined, "menu.pdf")).toBe("pdf");
  });

  it("treats an unknown payload as html — the most tolerant path", () => {
    expect(sniffSourceKind(html, "text/html")).toBe("html");
    expect(sniffSourceKind(Buffer.from("who knows"), undefined)).toBe("html");
  });

  it("does not mistake a zip-based non-xlsx for a spreadsheet by extension alone", () => {
    expect(sniffSourceKind(xlsx, undefined, "archive.zip")).toBe("xlsx");
  });
});
