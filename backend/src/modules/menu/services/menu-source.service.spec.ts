import { Logger } from "@nestjs/common";
import ExcelJS from "exceljs";
import {
  MenuSourceService,
  csvToRows,
  sniffCsvDelimiter,
} from "./menu-source.service";

/** A minimal EntitlementSet, entitled or not, for getForTenant to resolve. */
function entitlementSet(aiContentGeneration: boolean) {
  return {
    features: { "feature.aiContentGeneration": aiContentGeneration, "feature.license": true },
    limits: {},
    integrations: {},
    computedAt: new Date().toISOString(),
  };
}

describe("MenuSourceService", () => {
  let svc: MenuSourceService;
  let fetcher: { fetch: jest.Mock };
  let importSvc: {
    parseTextToDraft: jest.Mock;
    parseDocumentToDraft: jest.Mock;
    parseColumnMap: jest.Mock;
  };
  let quota: { claim: jest.Mock; attachJob: jest.Mock; voidUsage: jest.Mock };
  let entitlements: { getForTenant: jest.Mock };

  const TENANT = "t1";

  beforeEach(() => {
    fetcher = { fetch: jest.fn() };
    importSvc = {
      parseTextToDraft: jest.fn().mockResolvedValue({
        categories: [{ name: "Menü", products: [{ name: "Ayran", price: 25 }] }],
      }),
      parseDocumentToDraft: jest.fn().mockResolvedValue({
        categories: [{ name: "PDF", products: [{ name: "Kebap", price: 180 }] }],
      }),
      parseColumnMap: jest.fn(),
    };
    quota = {
      claim: jest.fn().mockResolvedValue("usage1"),
      attachJob: jest.fn().mockResolvedValue(undefined),
      voidUsage: jest.fn().mockResolvedValue(undefined),
    };
    // Entitled by default — most tests are about routing/metering, not the
    // gate itself. The gate-specific tests below override this per case.
    entitlements = {
      getForTenant: jest.fn().mockResolvedValue(entitlementSet(true)),
    };
    svc = new MenuSourceService(
      fetcher as any,
      importSvc as any,
      quota as any,
      entitlements as any,
      undefined, // EntitlementOfferResolver — optional, absent in these tests
    );
  });

  it("routes a CSV to the local mapper and never calls the model", async () => {
    fetcher.fetch.mockResolvedValue({
      bytes: Buffer.from("Ad,Fiyat,Kategori\nAyran,25,İçecekler\n"),
      contentType: "text/csv",
      filename: "menu.csv",
      finalUrl: "https://x.test/menu.csv",
    });

    const draft = await svc.parseSource(TENANT, { url: "https://x.test/menu.csv" });

    expect(draft.categories[0].name).toBe("İçecekler");
    expect(draft.categories[0].products[0].price).toBe(25);
    expect(importSvc.parseTextToDraft).not.toHaveBeenCalled();
    expect(quota.claim).not.toHaveBeenCalled();
  });

  it("routes a PDF to the document path and claims one unit", async () => {
    fetcher.fetch.mockResolvedValue({
      bytes: Buffer.from("%PDF-1.7 ..."),
      contentType: "application/pdf",
      filename: "menu.pdf",
      finalUrl: "https://x.test/menu.pdf",
    });

    const draft = await svc.parseSource(TENANT, { url: "https://x.test/menu.pdf" });

    expect(importSvc.parseDocumentToDraft).toHaveBeenCalled();
    expect(quota.claim).toHaveBeenCalledWith(TENANT, "PHOTO", 1);
    expect(draft.categories[0].name).toBe("PDF");
  });

  it("strips script/style from HTML before handing text to the model", async () => {
    fetcher.fetch.mockResolvedValue({
      bytes: Buffer.from(
        "<html><head><style>.a{}</style><script>var x=1</script></head><body><h2>İçecekler</h2><p>Ayran 25</p></body></html>",
      ),
      contentType: "text/html",
      finalUrl: "https://x.test/",
    });

    await svc.parseSource(TENANT, { url: "https://x.test/" });

    const text = importSvc.parseTextToDraft.mock.calls[0][0] as string;
    expect(text).toContain("İçecekler");
    expect(text).not.toContain("var x=1");
    expect(text).not.toContain(".a{}");
  });

  it("refunds every claimed unit when a chunk fails", async () => {
    fetcher.fetch.mockResolvedValue({
      bytes: Buffer.from("<html><body>" + "satır\n".repeat(20000) + "</body></html>"),
      contentType: "text/html",
      finalUrl: "https://x.test/",
    });
    importSvc.parseTextToDraft.mockRejectedValue(new Error("boom"));

    await expect(svc.parseSource(TENANT, { url: "https://x.test/" })).rejects.toThrow();
    expect(quota.voidUsage).toHaveBeenCalledWith("usage1");
  });

  it("rejects when neither url nor file is given", async () => {
    await expect(svc.parseSource(TENANT, {})).rejects.toThrow(/url or file/i);
  });

  it("parses an uploaded file directly, never touching the fetcher", async () => {
    const draft = await svc.parseSource(TENANT, {
      file: {
        buffer: Buffer.from("Ad,Fiyat\nAyran,25\n"),
        mimetype: "text/csv",
        originalname: "menu.csv",
      },
    });

    expect(fetcher.fetch).not.toHaveBeenCalled();
    expect(draft.categories[0].products[0]).toMatchObject({ name: "Ayran", price: 25 });
  });

  it("round-trips a real .xlsx workbook (exceljs) without ever calling the model", async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("Menü");
    sheet.addRow(["Ad", "Fiyat", "Kategori"]);
    sheet.addRow(["Ayran", 25, "İçecekler"]);
    sheet.addRow(["Kebap", 180.5, "Ana Yemekler"]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    fetcher.fetch.mockResolvedValue({
      bytes: buffer,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: "menu.xlsx",
      finalUrl: "https://x.test/menu.xlsx",
    });

    const draft = await svc.parseSource(TENANT, { url: "https://x.test/menu.xlsx" });

    const names = draft.categories.map((c) => c.name).sort();
    expect(names).toEqual(["Ana Yemekler", "İçecekler"]);
    const icecekler = draft.categories.find((c) => c.name === "İçecekler")!;
    expect(icecekler.products[0]).toMatchObject({ name: "Ayran", price: 25 });
    const anaYemekler = draft.categories.find((c) => c.name === "Ana Yemekler")!;
    expect(anaYemekler.products[0]).toMatchObject({ name: "Kebap", price: 180.5 });
    expect(importSvc.parseTextToDraft).not.toHaveBeenCalled();
    expect(importSvc.parseDocumentToDraft).not.toHaveBeenCalled();
    expect(quota.claim).not.toHaveBeenCalled();
  });

  it("rejects a spreadsheet that has a header row but no data rows", async () => {
    fetcher.fetch.mockResolvedValue({
      bytes: Buffer.from("Ad,Fiyat\n"),
      contentType: "text/csv",
      filename: "empty.csv",
      finalUrl: "https://x.test/empty.csv",
    });

    await expect(
      svc.parseSource(TENANT, { url: "https://x.test/empty.csv" }),
    ).rejects.toThrow(/no data rows/i);
    expect(quota.claim).not.toHaveBeenCalled();
  });

  it("rejects an HTML page with no readable text", async () => {
    fetcher.fetch.mockResolvedValue({
      bytes: Buffer.from("<html><head></head><body></body></html>"),
      contentType: "text/html",
      finalUrl: "https://x.test/blank",
    });

    await expect(
      svc.parseSource(TENANT, { url: "https://x.test/blank" }),
    ).rejects.toThrow(/nothing readable/i);
    expect(quota.claim).not.toHaveBeenCalled();
  });

  it("refuses a source past the chunk ceiling before claiming anything", async () => {
    fetcher.fetch.mockResolvedValue({
      bytes: Buffer.from("<html><body>" + "satır\n".repeat(30000) + "</body></html>"),
      contentType: "text/html",
      finalUrl: "https://x.test/huge",
    });

    await expect(
      svc.parseSource(TENANT, { url: "https://x.test/huge" }),
    ).rejects.toThrow(/too long/i);
    expect(quota.claim).not.toHaveBeenCalled();
    expect(importSvc.parseTextToDraft).not.toHaveBeenCalled();
  });

  it("spends exactly one unit asking the model to map unrecognised spreadsheet columns, then maps every row locally", async () => {
    fetcher.fetch.mockResolvedValue({
      bytes: Buffer.from("Ürün Kodu,Bedel\nAyran,25\nKebap,180\n"),
      contentType: "text/csv",
      filename: "menu.csv",
      finalUrl: "https://x.test/menu.csv",
    });
    importSvc.parseColumnMap.mockResolvedValue({ name: "Ürün Kodu", price: "Bedel" });

    const draft = await svc.parseSource(TENANT, { url: "https://x.test/menu.csv" });

    expect(quota.claim).toHaveBeenCalledWith(TENANT, "PHOTO", 1);
    expect(importSvc.parseColumnMap).toHaveBeenCalledTimes(1);
    const [sample] = importSvc.parseColumnMap.mock.calls[0];
    expect(sample).toContain("Ürün Kodu");
    expect(sample).toContain("Kebap");
    // Only the header + sample rows went to the model — never row-by-row.
    expect(importSvc.parseTextToDraft).not.toHaveBeenCalled();
    expect(draft.categories[0].products.map((p: any) => p.name)).toEqual(["Ayran", "Kebap"]);
  });

  it("refunds the claim when the model cannot identify both required columns", async () => {
    fetcher.fetch.mockResolvedValue({
      bytes: Buffer.from("Ürün Kodu,Bedel\nAyran,25\n"),
      contentType: "text/csv",
      filename: "menu.csv",
      finalUrl: "https://x.test/menu.csv",
    });
    importSvc.parseColumnMap.mockResolvedValue({ name: null, price: null });

    await expect(
      svc.parseSource(TENANT, { url: "https://x.test/menu.csv" }),
    ).rejects.toThrow(/could not tell/i);
    expect(quota.voidUsage).toHaveBeenCalledWith("usage1");
  });

  it("resolves the model's column map through case/diacritic-fold — 'ürün kodu' still matches header 'Ürün Kodu'", async () => {
    fetcher.fetch.mockResolvedValue({
      bytes: Buffer.from("Ürün Kodu,Bedel\nAyran,25\n"),
      contentType: "text/csv",
      filename: "menu.csv",
      finalUrl: "https://x.test/menu.csv",
    });
    // The model echoed the headers back lower-cased — exactly the kind of
    // case drift a model produces, not a different column.
    importSvc.parseColumnMap.mockResolvedValue({ name: "ürün kodu", price: "bedel" });

    const draft = await svc.parseSource(TENANT, { url: "https://x.test/menu.csv" });

    expect(draft.categories[0].products[0]).toMatchObject({ name: "Ayran", price: 25 });
    expect(quota.voidUsage).not.toHaveBeenCalled();
  });

  it("refunds a paid column map that names a header which does not actually exist on the sheet", async () => {
    fetcher.fetch.mockResolvedValue({
      bytes: Buffer.from("Ürün Kodu,Bedel\nAyran,25\n"),
      contentType: "text/csv",
      filename: "menu.csv",
      finalUrl: "https://x.test/menu.csv",
    });
    // "Urun Kodu" (diacritics dropped) is not the same string as the real
    // header "Ürün Kodu" even after folding — this must be treated as an
    // unresolved mapping, not silently matched or silently emptied.
    importSvc.parseColumnMap.mockResolvedValue({ name: "Urun Kodu", price: "Bedel" });

    await expect(
      svc.parseSource(TENANT, { url: "https://x.test/menu.csv" }),
    ).rejects.toThrow(/could not tell/i);
    expect(quota.voidUsage).toHaveBeenCalledWith("usage1");
  });

  it("refunds a paid column map whose resolved columns produce zero products, instead of resolving an empty draft", async () => {
    fetcher.fetch.mockResolvedValue({
      // Both headers are real and resolve, but every row's "Ürün Kodu"
      // cell is blank — rowsToDraft skips nameless rows, so this table has
      // no data behind it once mapped.
      bytes: Buffer.from("Ürün Kodu,Bedel\n,25\n,30\n"),
      contentType: "text/csv",
      filename: "menu.csv",
      finalUrl: "https://x.test/menu.csv",
    });
    importSvc.parseColumnMap.mockResolvedValue({ name: "Ürün Kodu", price: "Bedel" });

    await expect(
      svc.parseSource(TENANT, { url: "https://x.test/menu.csv" }),
    ).rejects.toThrow(/could not match any rows/i);
    expect(quota.voidUsage).toHaveBeenCalledWith("usage1");
  });

  it("rejects (without charging) a locally-recognised sheet whose rows produce zero products", async () => {
    fetcher.fetch.mockResolvedValue({
      // "Ad"/"Fiyat" are recognised locally — no model call — but every
      // name cell is blank.
      bytes: Buffer.from("Ad,Fiyat\n,25\n,30\n"),
      contentType: "text/csv",
      filename: "menu.csv",
      finalUrl: "https://x.test/menu.csv",
    });

    await expect(
      svc.parseSource(TENANT, { url: "https://x.test/menu.csv" }),
    ).rejects.toThrow(/could not match any rows/i);
    expect(quota.claim).not.toHaveBeenCalled();
    expect(importSvc.parseColumnMap).not.toHaveBeenCalled();
  });

  it("truncates long cells before sending the column-mapping sample to the model", async () => {
    const longDescription = "x".repeat(500);
    fetcher.fetch.mockResolvedValue({
      bytes: Buffer.from(`Ürün Kodu,Bedel,Not\nAyran,25,${longDescription}\n`),
      contentType: "text/csv",
      filename: "menu.csv",
      finalUrl: "https://x.test/menu.csv",
    });
    importSvc.parseColumnMap.mockResolvedValue({ name: "Ürün Kodu", price: "Bedel" });

    await svc.parseSource(TENANT, { url: "https://x.test/menu.csv" });

    const [sample] = importSvc.parseColumnMap.mock.calls[0];
    expect(sample).not.toContain(longDescription);
    // Truncated cell keeps a short prefix plus an ellipsis marker.
    expect(sample).toContain("x".repeat(80) + "…");
  });

  describe("real exceljs cell shapes — richText, formulas, dates, hyperlinks, sparse holes", () => {
    it("reads rich text, a numeric formula result, an error formula result, a Date, a hyperlink, and real 0/'' values — never '[object Object]'", async () => {
      const wb = new ExcelJS.Workbook();
      const sheet = wb.addWorksheet("Menü");
      sheet.addRow(["Ad", "Fiyat", "Açıklama"]);

      // Row 2: rich text name, formula → numeric result, plain description.
      sheet.getCell("A2").value = {
        richText: [{ text: "Acı ", font: { bold: true } }, { text: "Kebap" }],
      };
      sheet.getCell("B2").value = { formula: "SUM(1,179)", result: 180 };
      sheet.getCell("C2").value = "lezzetli";

      // Row 3: plain name, formula → error result (must become 0, not
      // "[object Object]" mis-parsed as 0 by accident), Date description.
      sheet.getCell("A3").value = "Ayran";
      sheet.getCell("B3").value = { formula: "1/0", result: { error: "#DIV/0!" } };
      sheet.getCell("C3").value = new Date("2026-08-19T00:00:00Z");

      // Row 4: hyperlink name, a REAL zero price, a REAL empty description —
      // both must survive as the falsy-but-valid values they are.
      sheet.getCell("A4").value = { text: "Kola", hyperlink: "https://example.test/kola" };
      sheet.getCell("B4").value = 0;
      sheet.getCell("C4").value = "";

      const buffer = Buffer.from(await wb.xlsx.writeBuffer());
      fetcher.fetch.mockResolvedValue({
        bytes: buffer,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename: "menu.xlsx",
        finalUrl: "https://x.test/menu.xlsx",
      });

      const draft = await svc.parseSource(TENANT, { url: "https://x.test/menu.xlsx" });

      const products = draft.categories[0].products as any[];
      expect(products.map((p) => p.name)).toEqual(["Acı Kebap", "Ayran", "Kola"]);
      for (const p of products) {
        expect(p.name).not.toContain("[object Object]");
      }
      expect(products[0]).toMatchObject({ name: "Acı Kebap", price: 180, description: "lezzetli" });
      // Error-formula price reads as 0 — a deliberate "unreadable price"
      // outcome, not a stringified-object coincidence.
      expect(products[1]).toMatchObject({ name: "Ayran", price: 0 });
      expect(products[1].description).toContain("2026-08-19");
      expect(products[2]).toMatchObject({ name: "Kola", price: 0 });
      expect(importSvc.parseTextToDraft).not.toHaveBeenCalled();
      expect(importSvc.parseColumnMap).not.toHaveBeenCalled();
      expect(quota.claim).not.toHaveBeenCalled();
    });

    it("does not crash on a blank spacer header column (sparse row.values hole)", async () => {
      const wb = new ExcelJS.Workbook();
      const sheet = wb.addWorksheet("Menü");
      // Column B is never written — a genuine sparse hole in row.values,
      // not a defined empty string.
      sheet.getCell("A1").value = "Ad";
      sheet.getCell("C1").value = "Fiyat";
      sheet.getCell("A2").value = "Ayran";
      sheet.getCell("C2").value = 25;

      const buffer = Buffer.from(await wb.xlsx.writeBuffer());
      fetcher.fetch.mockResolvedValue({
        bytes: buffer,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename: "menu.xlsx",
        finalUrl: "https://x.test/menu.xlsx",
      });

      const draft = await svc.parseSource(TENANT, { url: "https://x.test/menu.xlsx" });

      expect(draft.categories[0].products[0]).toMatchObject({ name: "Ayran", price: 25 });
    });
  });

  describe("malformed input surfaces an actionable 400, not a raw parser error", () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    });
    afterEach(() => {
      warnSpy.mockRestore();
    });

    it("wraps a csv-parse unmatched-quote error into a clear BadRequestException", async () => {
      fetcher.fetch.mockResolvedValue({
        // An opening quote appears mid-field without being the field's
        // first character — csv-parse throws INVALID_OPENING_QUOTE for this.
        bytes: Buffer.from('Ad,Fiyat\nPizza 12",25\n'),
        contentType: "text/csv",
        filename: "menu.csv",
        finalUrl: "https://x.test/menu.csv",
      });

      await expect(
        svc.parseSource(TENANT, { url: "https://x.test/menu.csv" }),
      ).rejects.toThrow(/unmatched quote/i);
      expect(quota.claim).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
    });

    it("wraps a corrupt .xlsx (unreadable zip) into a clear BadRequestException", async () => {
      const bytes = Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x03, 0x04]), // PK.. — sniffs as xlsx
        Buffer.from("not actually a zip file"),
      ]);
      fetcher.fetch.mockResolvedValue({
        bytes,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename: "menu.xlsx",
        finalUrl: "https://x.test/menu.xlsx",
      });

      await expect(
        svc.parseSource(TENANT, { url: "https://x.test/menu.xlsx" }),
      ).rejects.toThrow(/could not be read/i);
      expect(quota.claim).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe("AI entitlement gate — asserted per model-calling path, not on the whole endpoint", () => {
    it("a recognised-header CSV succeeds with no entitlement at all (never calls the model)", async () => {
      entitlements.getForTenant.mockResolvedValue(entitlementSet(false));
      fetcher.fetch.mockResolvedValue({
        bytes: Buffer.from("Ad,Fiyat,Kategori\nAyran,25,İçecekler\n"),
        contentType: "text/csv",
        filename: "menu.csv",
        finalUrl: "https://x.test/menu.csv",
      });

      const draft = await svc.parseSource(TENANT, { url: "https://x.test/menu.csv" });

      expect(draft.categories[0].products[0]).toMatchObject({ name: "Ayran", price: 25 });
      // The gate must not even be consulted on this path.
      expect(entitlements.getForTenant).not.toHaveBeenCalled();
      expect(quota.claim).not.toHaveBeenCalled();
    });

    it("a PDF is refused without the entitlement, before any credit is claimed", async () => {
      entitlements.getForTenant.mockResolvedValue(entitlementSet(false));
      fetcher.fetch.mockResolvedValue({
        bytes: Buffer.from("%PDF-1.7 ..."),
        contentType: "application/pdf",
        filename: "menu.pdf",
        finalUrl: "https://x.test/menu.pdf",
      });

      await expect(
        svc.parseSource(TENANT, { url: "https://x.test/menu.pdf" }),
      ).rejects.toMatchObject({ status: 403 });
      expect(quota.claim).not.toHaveBeenCalled();
      expect(importSvc.parseDocumentToDraft).not.toHaveBeenCalled();
    });

    it("HTML/text is refused without the entitlement, before any credit is claimed", async () => {
      entitlements.getForTenant.mockResolvedValue(entitlementSet(false));
      fetcher.fetch.mockResolvedValue({
        bytes: Buffer.from("<html><body><h2>İçecekler</h2><p>Ayran 25</p></body></html>"),
        contentType: "text/html",
        finalUrl: "https://x.test/",
      });

      await expect(
        svc.parseSource(TENANT, { url: "https://x.test/" }),
      ).rejects.toMatchObject({ status: 403 });
      expect(quota.claim).not.toHaveBeenCalled();
      expect(importSvc.parseTextToDraft).not.toHaveBeenCalled();
    });

    it("an unrecognised-header CSV is refused without the entitlement, before any credit is claimed", async () => {
      entitlements.getForTenant.mockResolvedValue(entitlementSet(false));
      fetcher.fetch.mockResolvedValue({
        bytes: Buffer.from("Ürün Kodu,Bedel\nAyran,25\n"),
        contentType: "text/csv",
        filename: "menu.csv",
        finalUrl: "https://x.test/menu.csv",
      });

      await expect(
        svc.parseSource(TENANT, { url: "https://x.test/menu.csv" }),
      ).rejects.toMatchObject({ status: 403 });
      expect(quota.claim).not.toHaveBeenCalled();
      expect(importSvc.parseColumnMap).not.toHaveBeenCalled();
    });

    it("the 403 carries the same ENTITLEMENT_REQUIRED shape EntitlementGuard produces", async () => {
      entitlements.getForTenant.mockResolvedValue(entitlementSet(false));
      fetcher.fetch.mockResolvedValue({
        bytes: Buffer.from("%PDF-1.7 ..."),
        contentType: "application/pdf",
        filename: "menu.pdf",
        finalUrl: "https://x.test/menu.pdf",
      });

      await expect(
        svc.parseSource(TENANT, { url: "https://x.test/menu.pdf" }),
      ).rejects.toMatchObject({
        status: 403,
        response: expect.objectContaining({
          errorCode: "ENTITLEMENT_REQUIRED",
          requirement: { type: "feature", key: "feature.aiContentGeneration" },
        }),
      });
    });

    it("honours a BRANCH-SCOPED grant — getForTenant is called with the caller's branch id, not a hardcoded null", async () => {
      // Entitled ONLY at branch "b1" (e.g. a superadmin comp issued with a
      // branchId, per comp.dto.ts) — a tenant-wide (null) lookup is false.
      entitlements.getForTenant.mockImplementation(
        (_tenantId: string, branchId: string | null) =>
          Promise.resolve(entitlementSet(branchId === "b1")),
      );
      fetcher.fetch.mockResolvedValue({
        bytes: Buffer.from("%PDF-1.7 ..."),
        contentType: "application/pdf",
        filename: "menu.pdf",
        finalUrl: "https://x.test/menu.pdf",
      });

      const draft = await svc.parseSource(
        TENANT,
        { url: "https://x.test/menu.pdf" },
        "b1",
      );

      expect(entitlements.getForTenant).toHaveBeenCalledWith(TENANT, "b1");
      expect(draft.categories[0].name).toBe("PDF");
    });

    it("without a branch id, a branch-scoped-only grant is correctly NOT honoured (null reaches getForTenant)", async () => {
      entitlements.getForTenant.mockImplementation(
        (_tenantId: string, branchId: string | null) =>
          Promise.resolve(entitlementSet(branchId === "b1")),
      );
      fetcher.fetch.mockResolvedValue({
        bytes: Buffer.from("%PDF-1.7 ..."),
        contentType: "application/pdf",
        filename: "menu.pdf",
        finalUrl: "https://x.test/menu.pdf",
      });

      // No third argument — the tenant-wide (branchless) call site.
      await expect(
        svc.parseSource(TENANT, { url: "https://x.test/menu.pdf" }),
      ).rejects.toMatchObject({ status: 403 });
      expect(entitlements.getForTenant).toHaveBeenCalledWith(TENANT, null);
    });
  });

  describe("CSV delimiter sniffing — an array delimiter to csv-parse means ALL of them at once, not 'pick one'", () => {
    it("sniffCsvDelimiter picks ';' for a Turkish semicolon header", () => {
      expect(sniffCsvDelimiter("Ürün Adı;Açıklama;Fiyat;Kategori")).toBe(";");
    });

    it("sniffCsvDelimiter picks ',' for a plain comma header", () => {
      expect(sniffCsvDelimiter("Ad,Fiyat,Kategori")).toBe(",");
    });

    it("sniffCsvDelimiter picks tab for a tab-separated header", () => {
      expect(sniffCsvDelimiter("Ad\tFiyat\tKategori")).toBe("\t");
    });

    it("sniffCsvDelimiter ignores delimiter characters inside quotes", () => {
      expect(sniffCsvDelimiter('Ürün Adı;"Açıklama, uzun metin";Fiyat')).toBe(";");
    });

    it("sniffCsvDelimiter falls back to ',' when no delimiter is present (single column)", () => {
      expect(sniffCsvDelimiter("Ürün")).toBe(",");
    });

    it("csvToRows correctly splits a Turkish semicolon file with decimal-comma prices, instead of shredding on both characters", () => {
      const bytes = Buffer.from(
        "Ürün Adı;Açıklama;Fiyat;Kategori\nAdana Kebap;Acılı;180,50;Ana Yemekler\n",
      );
      const rows = csvToRows(bytes);
      expect(rows[0]).toEqual(["Ürün Adı", "Açıklama", "Fiyat", "Kategori"]);
      // Previously (delimiter: [",",";","\t"]) this came back as 5 fields:
      // ["Adana Kebap","Acılı","180","50","Ana Yemekler"].
      expect(rows[1]).toEqual(["Adana Kebap", "Acılı", "180,50", "Ana Yemekler"]);
    });

    it("csvToRows parses a plain comma file correctly", () => {
      const rows = csvToRows(Buffer.from("Ad,Fiyat\nAyran,25\n"));
      expect(rows).toEqual([["Ad", "Fiyat"], ["Ayran", "25"]]);
    });

    it("csvToRows parses a tab-delimited file correctly", () => {
      const rows = csvToRows(Buffer.from("Ad\tFiyat\nAyran\t25\n"));
      expect(rows).toEqual([["Ad", "Fiyat"], ["Ayran", "25"]]);
    });

    it("csvToRows keeps a quoted comma intact inside a semicolon-delimited field", () => {
      const bytes = Buffer.from(
        'Ürün Adı;Açıklama;Fiyat\nAdana Kebap;"Acılı, baharatlı, közlenmiş";180,50\n',
      );
      const rows = csvToRows(bytes);
      expect(rows[1]).toEqual(["Adana Kebap", "Acılı, baharatlı, közlenmiş", "180,50"]);
    });

    it("csvToRows handles a single-column file with no delimiter at all", () => {
      const rows = csvToRows(Buffer.from("Ürün\nAyran\nKebap\n"));
      expect(rows).toEqual([["Ürün"], ["Ayran"], ["Kebap"]]);
    });

    it("end-to-end: a Turkish semicolon CSV with comma-decimal prices imports the right names/prices/categories — no more '50'/'90' phantom categories", async () => {
      fetcher.fetch.mockResolvedValue({
        bytes: Buffer.from(
          "Ürün Adı;Açıklama;Fiyat;Kategori\n" +
            "Adana Kebap;Acılı;180,50;Ana Yemekler\n" +
            "Ayran;;12,90;İçecekler\n",
        ),
        contentType: "text/csv",
        filename: "menu.csv",
        finalUrl: "https://x.test/menu.csv",
      });

      const draft = await svc.parseSource(TENANT, { url: "https://x.test/menu.csv" });

      const categoryNames = (draft.categories as any[]).map((c) => c.name).sort();
      expect(categoryNames).toEqual(["Ana Yemekler", "İçecekler"]);
      expect(categoryNames).not.toContain("50");
      expect(categoryNames).not.toContain("90");
      const anaYemekler = (draft.categories as any[]).find((c) => c.name === "Ana Yemekler")!;
      expect(anaYemekler.products[0]).toMatchObject({ name: "Adana Kebap", price: 180.5 });
      const icecekler = (draft.categories as any[]).find((c) => c.name === "İçecekler")!;
      expect(icecekler.products[0]).toMatchObject({ name: "Ayran", price: 12.9 });
      // Recognised headers — still never touches the model or the gate.
      expect(importSvc.parseColumnMap).not.toHaveBeenCalled();
      expect(quota.claim).not.toHaveBeenCalled();
    });

    it("sniffs from the first NON-empty line — one or more leading blank lines must not defeat the sniff", () => {
      // A blank first line makes sniffCsvDelimiter("") fall back to ",",
      // which would shred this exact Turkish file the same way the
      // original bug did if csvToRows sniffed literally the first line.
      const bytes = Buffer.from(
        "\n\n" +
          "Ürün Adı;Açıklama;Fiyat;Kategori\n" +
          "Adana Kebap;Acılı;180,50;Ana Yemekler\n",
      );
      const rows = csvToRows(bytes);
      expect(rows[0]).toEqual(["Ürün Adı", "Açıklama", "Fiyat", "Kategori"]);
      expect(rows[1]).toEqual(["Adana Kebap", "Acılı", "180,50", "Ana Yemekler"]);
    });

    it("treats a whitespace-only leading line as blank too", () => {
      const bytes = Buffer.from(
        "   \n\t\n" +
          "Ürün Adı;Açıklama;Fiyat;Kategori\nAdana Kebap;Acılı;180,50;Ana Yemekler\n",
      );
      const rows = csvToRows(bytes);
      expect(rows[0]).toEqual(["Ürün Adı", "Açıklama", "Fiyat", "Kategori"]);
      expect(rows[1]).toEqual(["Adana Kebap", "Acılı", "180,50", "Ana Yemekler"]);
    });

    it("end-to-end: leading blank lines before a Turkish semicolon header still import correctly through parseSource", async () => {
      fetcher.fetch.mockResolvedValue({
        bytes: Buffer.from(
          "\n" +
            "Ürün Adı;Açıklama;Fiyat;Kategori\n" +
            "Adana Kebap;Acılı;180,50;Ana Yemekler\n",
        ),
        contentType: "text/csv",
        filename: "menu.csv",
        finalUrl: "https://x.test/menu.csv",
      });

      const draft = await svc.parseSource(TENANT, { url: "https://x.test/menu.csv" });

      const categoryNames = (draft.categories as any[]).map((c) => c.name);
      expect(categoryNames).toEqual(["Ana Yemekler"]);
      expect(draft.categories[0].products[0]).toMatchObject({
        name: "Adana Kebap",
        price: 180.5,
      });
    });
  });
});
