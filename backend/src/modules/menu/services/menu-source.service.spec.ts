import ExcelJS from "exceljs";
import { MenuSourceService } from "./menu-source.service";

describe("MenuSourceService", () => {
  let svc: MenuSourceService;
  let fetcher: { fetch: jest.Mock };
  let importSvc: {
    parseTextToDraft: jest.Mock;
    parseDocumentToDraft: jest.Mock;
    parseColumnMap: jest.Mock;
  };
  let quota: { claim: jest.Mock; attachJob: jest.Mock; voidUsage: jest.Mock };

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
    svc = new MenuSourceService(fetcher as any, importSvc as any, quota as any);
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
});
