import { MenuImportService } from "./menu-import.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";

jest.mock("axios");
import axios from "axios";

describe("MenuImportService", () => {
  let prisma: MockPrismaClient;
  let config: { get: jest.Mock };
  let categories: { create: jest.Mock };
  let products: { create: jest.Mock; update: jest.Mock };
  let entitlements: { getForTenant: jest.Mock };
  let svc: MenuImportService;

  const TENANT = "t1";

  beforeEach(() => {
    // axios is module-mocked once for the whole file (jest.mock("axios") at
    // the top), so its call history is otherwise cumulative across every
    // `it` here — clear it so a test asserting on axios.post's call count
    // or args never sees a call made by an earlier test.
    (axios.post as jest.Mock).mockClear();
    prisma = mockPrismaClient();
    config = { get: jest.fn() };
    categories = { create: jest.fn() };
    products = { create: jest.fn(), update: jest.fn() };
    entitlements = {
      getForTenant: jest.fn().mockResolvedValue({ limits: {} }),
    };
    const quota = {
      claim: jest.fn().mockResolvedValue("usage1"),
      attachJob: jest.fn().mockResolvedValue(undefined),
      voidUsage: jest.fn().mockResolvedValue(undefined),
      voidByJob: jest.fn().mockResolvedValue(undefined),
    };
    svc = new MenuImportService(
      prisma as any,
      config as any,
      categories as any,
      products as any,
      entitlements as any,
      quota as any,
    );
    (prisma.category.findMany as any).mockResolvedValue([]);
    (prisma.product.count as any).mockResolvedValue(0);
    (prisma.category.count as any).mockResolvedValue(0);
  });

  describe("isConfigured / gate", () => {
    it("is false without an API key and parse() throws a clear error", async () => {
      config.get.mockReturnValue(undefined);
      expect(svc.isConfigured()).toBe(false);
      await expect(
        svc.parseMenuPhotos("t1", [{ buffer: Buffer.from("x"), mimetype: "image/png" }]),
      ).rejects.toThrow(/not configured/i);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it("is true when the key is present", () => {
      config.get.mockImplementation((k: string) =>
        k === "ANTHROPIC_API_KEY" ? "sk-test" : undefined,
      );
      expect(svc.isConfigured()).toBe(true);
    });
  });

  describe("parseMenuPhotos → normalise", () => {
    beforeEach(() => {
      config.get.mockImplementation((k: string) =>
        k === "ANTHROPIC_API_KEY" ? "sk-test" : undefined,
      );
    });

    const mockAnthropic = (jsonText: string) =>
      (axios.post as any).mockResolvedValue({
        data: { content: [{ type: "text", text: jsonText }] },
      });

    it("parses a clean JSON menu and clamps prices to 2dp", async () => {
      mockAnthropic(
        JSON.stringify({
          categories: [
            {
              name: "Ana Yemekler",
              products: [
                { name: "Adana", description: "acılı", price: 180.005 },
                { name: "Urfa", price: "150" },
              ],
            },
          ],
        }),
      );
      const draft = await svc.parseMenuPhotos("t1", [
        { buffer: Buffer.from("img"), mimetype: "image/jpeg" },
      ]);
      expect(draft.categories).toHaveLength(1);
      expect(draft.categories[0].name).toBe("Ana Yemekler");
      expect(draft.categories[0].products[0].price).toBe(180.01);
      expect(draft.categories[0].products[1].price).toBe(150); // string coerced
    });

    it("strips markdown fences and drops empty categories + nameless items", async () => {
      mockAnthropic(
        "```json\n" +
          JSON.stringify({
            categories: [
              { name: "Boş", products: [{ name: "", price: 10 }] },
              { name: "İçecekler", products: [{ name: "Ayran", price: 30 }] },
            ],
          }) +
          "\n```",
      );
      const draft = await svc.parseMenuPhotos("t1", [
        { buffer: Buffer.from("img"), mimetype: "image/png" },
      ]);
      // "Boş" had only a nameless product → dropped; only İçecekler survives.
      expect(draft.categories.map((c) => c.name)).toEqual(["İçecekler"]);
    });

    it("coerces an unreadable price to 0 and an invalid taxRate to undefined", async () => {
      mockAnthropic(
        JSON.stringify({
          categories: [
            { name: "X", products: [{ name: "Y", price: "abc", taxRate: 7 }] },
          ],
        }),
      );
      const draft = await svc.parseMenuPhotos("t1", [
        { buffer: Buffer.from("img"), mimetype: "image/webp" },
      ]);
      expect(draft.categories[0].products[0].price).toBe(0);
      expect(draft.categories[0].products[0].taxRate).toBeUndefined();
    });

    it("throws a friendly error when no JSON object is present", async () => {
      mockAnthropic("Sorry, I could not read the image.");
      await expect(
        svc.parseMenuPhotos("t1", [{ buffer: Buffer.from("img"), mimetype: "image/jpeg" }]),
      ).rejects.toThrow(/clearer/i);
    });
  });

  describe("commitDraft", () => {
    const draft = {
      categories: [
        {
          name: "Ana Yemekler",
          products: [
            { name: "Adana", price: 180 },
            { name: "Urfa", price: 150 },
          ],
        },
        { name: "İçecekler", products: [{ name: "Ayran", price: 30 }] },
      ],
    };

    it("creates new categories + products and reports a summary", async () => {
      categories.create.mockImplementation(async ({ name }: any) => ({
        id: `cat-${name}`,
      }));
      products.create.mockResolvedValue({ id: "p" });

      const summary = await svc.commitDraft(draft as any, TENANT);

      expect(summary.categoriesCreated).toBe(2);
      expect(summary.categoriesMatched).toBe(0);
      expect(summary.productsCreated).toBe(3);
      expect(summary.failures).toEqual([]);
      // Product create defaults taxRate to 10 (fiscal correctness).
      expect(products.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Adana", taxRate: 10, categoryId: "cat-Ana Yemekler" }),
        TENANT,
      );
    });

    it("matches an existing category by case-insensitive name instead of recreating it", async () => {
      (prisma.category.findMany as any).mockResolvedValue([
        { id: "existing-1", name: "ana yemekler" },
      ]);
      categories.create.mockImplementation(async ({ name }: any) => ({
        id: `cat-${name}`,
      }));
      products.create.mockResolvedValue({ id: "p" });

      const summary = await svc.commitDraft(draft as any, TENANT);

      expect(summary.categoriesMatched).toBe(1); // "Ana Yemekler" == existing
      expect(summary.categoriesCreated).toBe(1); // only İçecekler is new
      // Adana went onto the matched category id.
      expect(products.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Adana", categoryId: "existing-1" }),
        TENANT,
      );
    });

    it("matches an existing category via Turkish-locale folding, not plain toLowerCase", async () => {
      // "İÇECEKLER".toLowerCase() (default/ASCII fold) yields "i̇çecekler" —
      // an ASCII i plus a combining dot above — which never equals the
      // stored "içecekler". Only foldMenuKey's tr-TR fold makes these match.
      (prisma.category.findMany as any).mockResolvedValue([
        { id: "existing-tr", name: "içecekler" },
      ]);
      categories.create.mockImplementation(async ({ name }: any) => ({
        id: `cat-${name}`,
      }));
      products.create.mockResolvedValue({ id: "p" });

      const summary = await svc.commitDraft(
        {
          categories: [
            { name: "İÇECEKLER", products: [{ name: "Ayran", price: 25 }] },
          ],
        } as any,
        TENANT,
      );

      expect(summary.categoriesMatched).toBe(1);
      expect(summary.categoriesCreated).toBe(0);
      expect(products.create).toHaveBeenCalledWith(
        expect.objectContaining({ categoryId: "existing-tr" }),
        TENANT,
      );
    });

    it("collects a per-product failure without aborting the rest of the import", async () => {
      categories.create.mockImplementation(async ({ name }: any) => ({
        id: `cat-${name}`,
      }));
      products.create
        .mockResolvedValueOnce({ id: "p1" })
        .mockRejectedValueOnce(new Error("dup name"))
        .mockResolvedValueOnce({ id: "p3" });

      const summary = await svc.commitDraft(draft as any, TENANT);

      expect(summary.productsCreated).toBe(2);
      expect(summary.failures).toHaveLength(1);
      expect(summary.failures[0]).toMatchObject({ product: "Urfa", reason: "dup name" });
    });

    it("rejects up front when the import would exceed the plan product limit", async () => {
      entitlements.getForTenant.mockResolvedValue({
        limits: { "limit.maxProducts": 2 },
      });
      (prisma.product.count as any).mockResolvedValue(1); // 1 used + 3 new > 2

      await expect(svc.commitDraft(draft as any, TENANT)).rejects.toThrow(
        /product limit/i,
      );
      expect(products.create).not.toHaveBeenCalled();
    });

    it("allows the import when the limit is unlimited (-1)", async () => {
      entitlements.getForTenant.mockResolvedValue({
        limits: { "limit.maxProducts": -1, "limit.maxCategories": -1 },
      });
      categories.create.mockImplementation(async ({ name }: any) => ({
        id: `cat-${name}`,
      }));
      products.create.mockResolvedValue({ id: "p" });

      const summary = await svc.commitDraft(draft as any, TENANT);
      expect(summary.productsCreated).toBe(3);
    });
  });

  describe("conflicts", () => {
    it("annotates a draft row that already exists in the same category", async () => {
      (prisma.product.findMany as any).mockResolvedValue([
        { id: "p1", name: "Ayran", price: 20, category: { name: "İçecekler" } },
      ]);
      const draft = {
        categories: [
          { name: "içecekler", products: [{ name: " ayran ", price: 25 }, { name: "Kola", price: 30 }] },
        ],
      };

      const out = await svc.annotateConflicts(draft as any, TENANT);

      expect(out.categories[0].products[0]).toMatchObject({
        existingProductId: "p1",
        onConflict: "SKIP",
      });
      expect(out.categories[0].products[1].existingProductId).toBeUndefined();
    });

    it("does not match the same name in a different category", async () => {
      (prisma.product.findMany as any).mockResolvedValue([
        { id: "p1", name: "Ayran", price: 20, category: { name: "İçecekler" } },
      ]);
      const out = await svc.annotateConflicts(
        { categories: [{ name: "Menüler", products: [{ name: "Ayran", price: 25 }] }] } as any,
        TENANT,
      );
      expect(out.categories[0].products[0].existingProductId).toBeUndefined();
    });

    it("does not pick a winner when two existing products already share a (category, name) fold key", async () => {
      // Product has no unique constraint on (categoryId, name), and this is
      // exactly the population the feature exists for: a tenant whose menu
      // was already doubled by the old unconditional-CREATE commitDraft.
      (prisma.product.findMany as any).mockResolvedValue([
        { id: "p1", name: "Ayran", price: 20, category: { name: "İçecekler" } },
        { id: "p2", name: "Ayran", price: 22, category: { name: "İçecekler" } },
      ]);
      const out = await svc.annotateConflicts(
        { categories: [{ name: "İçecekler", products: [{ name: "Ayran", price: 25 }] }] } as any,
        TENANT,
      );
      // No id silently chosen — neither p1 nor p2 — and the grid gets a
      // marker instead so it can't be committed as an unnoticed UPDATE_PRICE.
      expect(out.categories[0].products[0].existingProductId).toBeUndefined();
      expect((out.categories[0].products[0] as any).ambiguous).toBe(true);
    });

    it("does not let two identical rows in the SAME draft claim the same existing product", async () => {
      (prisma.product.findMany as any).mockResolvedValue([
        { id: "p1", name: "Ayran", price: 20, category: { name: "İçecekler" } },
      ]);
      const out = await svc.annotateConflicts(
        {
          categories: [
            {
              name: "İçecekler",
              // A duplicated OCR read: the same row twice in one draft.
              products: [{ name: "Ayran", price: 25 }, { name: "Ayran", price: 27 }],
            },
          ],
        } as any,
        TENANT,
      );
      expect(out.categories[0].products[0].existingProductId).toBe("p1");
      expect(out.categories[0].products[1].existingProductId).toBeUndefined();
      expect((out.categories[0].products[1] as any).ambiguous).toBe(true);
    });

    it("SKIP creates and updates nothing, and counts as skipped", async () => {
      (prisma.category.findMany as any).mockResolvedValue([{ id: "c1", name: "İçecekler" }]);
      const s = await svc.commitDraft(
        { categories: [{ name: "İçecekler", products: [
          { name: "Ayran", price: 25, onConflict: "SKIP", existingProductId: "p1" },
        ] }] } as any,
        TENANT,
      );
      expect(products.create).not.toHaveBeenCalled();
      expect(products.update).not.toHaveBeenCalled();
      expect(s.productsSkipped).toBe(1);
      expect(s.productsCreated).toBe(0);
    });

    it("a row with onConflict set but no existingProductId behaves as CREATE (BulkAddModal parity)", async () => {
      (prisma.category.findMany as any).mockResolvedValue([{ id: "c1", name: "İçecekler" }]);
      products.create.mockResolvedValue({ id: "new-1" });
      const s = await svc.commitDraft(
        {
          categories: [
            {
              name: "İçecekler",
              // onConflict present, but no existingProductId to act on —
              // must not be treated as SKIP/UPDATE_PRICE.
              products: [{ name: "Ayran", price: 25, onConflict: "UPDATE_PRICE" }],
            },
          ],
        } as any,
        TENANT,
      );
      expect(products.update).not.toHaveBeenCalled();
      expect(products.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Ayran", price: 25 }),
        TENANT,
      );
      expect(s.productsCreated).toBe(1);
      expect(s.productsUpdated).toBe(0);
      expect(s.productsSkipped).toBe(0);
    });

    it("a legacy draft with no conflict fields at all leaves productsUpdated/productsSkipped at 0", async () => {
      (prisma.category.findMany as any).mockResolvedValue([{ id: "c1", name: "İçecekler" }]);
      products.create.mockResolvedValue({ id: "new-1" });
      const s = await svc.commitDraft(
        { categories: [{ name: "İçecekler", products: [{ name: "Ayran", price: 25 }] }] } as any,
        TENANT,
      );
      expect(s.productsCreated).toBe(1);
      expect(s.productsUpdated).toBe(0);
      expect(s.productsSkipped).toBe(0);
    });

    it("UPDATE_PRICE touches only the price", async () => {
      (prisma.category.findMany as any).mockResolvedValue([{ id: "c1", name: "İçecekler" }]);
      (prisma.product.findFirst as any).mockResolvedValue({
        id: "p1",
        tenantId: TENANT,
        name: "Ayran",
        category: { name: "İçecekler" },
      });
      const s = await svc.commitDraft(
        { categories: [{ name: "İçecekler", products: [
          { name: "Ayran", price: 25, description: "yeni", onConflict: "UPDATE_PRICE", existingProductId: "p1" },
        ] }] } as any,
        TENANT,
      );
      expect(products.update).toHaveBeenCalledWith("p1", { price: 25 }, TENANT);
      expect(s.productsUpdated).toBe(1);
    });

    it("refuses to update a product belonging to another tenant", async () => {
      (prisma.category.findMany as any).mockResolvedValue([{ id: "c1", name: "İçecekler" }]);
      (prisma.product.findFirst as any).mockResolvedValue(null); // not found for THIS tenant
      const s = await svc.commitDraft(
        { categories: [{ name: "İçecekler", products: [
          { name: "Ayran", price: 25, onConflict: "UPDATE_PRICE", existingProductId: "someone-elses" },
        ] }] } as any,
        TENANT,
      );
      expect(products.update).not.toHaveBeenCalled();
      expect(s.failures[0].reason).toMatch(/not found/i);
    });

    it("refuses to update a product the row no longer matches (renamed/re-categorised in the review grid)", async () => {
      // existingProductId belongs to this tenant, but the row's (category,
      // name) no longer folds to what that product currently is — an
      // operator edit in the grid, or a crafted id naming a different row's
      // product. Must fail the row rather than reprice whatever this id
      // currently points to.
      (prisma.category.findMany as any).mockResolvedValue([{ id: "c1", name: "İçecekler" }]);
      (prisma.product.findFirst as any).mockResolvedValue({
        id: "p1",
        tenantId: TENANT,
        name: "Kola", // actual product is "Kola" ...
        category: { name: "İçecekler" },
      });
      const s = await svc.commitDraft(
        { categories: [{ name: "İçecekler", products: [
          // ... but the row claims "Ayran".
          { name: "Ayran", price: 25, onConflict: "UPDATE_PRICE", existingProductId: "p1" },
        ] }] } as any,
        TENANT,
      );
      expect(products.update).not.toHaveBeenCalled();
      expect(s.productsUpdated).toBe(0);
      expect(s.failures[0].reason).toMatch(/no longer matches/i);
    });

    it("refuses UPDATE_PRICE when the row's price is 0 (an unreadable price, not a real quote)", async () => {
      (prisma.category.findMany as any).mockResolvedValue([{ id: "c1", name: "İçecekler" }]);
      (prisma.product.findFirst as any).mockResolvedValue({
        id: "p1",
        tenantId: TENANT,
        name: "Ayran",
        category: { name: "İçecekler" },
      });
      const s = await svc.commitDraft(
        { categories: [{ name: "İçecekler", products: [
          { name: "Ayran", price: 0, onConflict: "UPDATE_PRICE", existingProductId: "p1" },
        ] }] } as any,
        TENANT,
      );
      expect(products.update).not.toHaveBeenCalled();
      expect(s.productsUpdated).toBe(0);
      expect(s.failures[0].reason).toMatch(/price could not be read/i);
    });

    it("creating a NEW product at 0 stays allowed (only UPDATE_PRICE refuses 0)", async () => {
      (prisma.category.findMany as any).mockResolvedValue([{ id: "c1", name: "İçecekler" }]);
      products.create.mockResolvedValue({ id: "new-1" });
      const s = await svc.commitDraft(
        { categories: [{ name: "İçecekler", products: [{ name: "Bedava Su", price: 0 }] }] } as any,
        TENANT,
      );
      expect(products.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Bedava Su", price: 0 }),
        TENANT,
      );
      expect(s.productsCreated).toBe(1);
      expect(s.failures).toEqual([]);
    });

    it("does not double-count when two rows in the same commit target the same existingProductId", async () => {
      // Defence in depth: /commit is callable directly without going
      // through annotateConflicts first, so a crafted body can still name
      // the same existingProductId twice. The summary must never claim
      // more updates than products actually touched.
      (prisma.category.findMany as any).mockResolvedValue([{ id: "c1", name: "İçecekler" }]);
      (prisma.product.findFirst as any).mockResolvedValue({
        id: "p1",
        tenantId: TENANT,
        name: "Ayran",
        category: { name: "İçecekler" },
      });
      const s = await svc.commitDraft(
        {
          categories: [
            {
              name: "İçecekler",
              products: [
                { name: "Ayran", price: 25, onConflict: "UPDATE_PRICE", existingProductId: "p1" },
                { name: "Ayran", price: 30, onConflict: "UPDATE_PRICE", existingProductId: "p1" },
              ],
            },
          ],
        } as any,
        TENANT,
      );
      expect(products.update).toHaveBeenCalledTimes(1);
      expect(products.update).toHaveBeenCalledWith("p1", { price: 25 }, TENANT);
      expect(s.productsUpdated).toBe(1);
      expect(s.failures).toHaveLength(1);
      expect(s.failures[0].reason).toMatch(/already updated/i);
    });

    it("counts only rows that will actually be created toward the plan-limit check", async () => {
      // limit=2, 1 already used. Three draft rows: one SKIP, one
      // UPDATE_PRICE, one real CREATE. A naive count of all 3 rows would
      // reject (1 + 3 = 4 > 2); counting only the row that actually creates
      // a product must allow it (1 + 1 = 2, not > 2).
      entitlements.getForTenant.mockResolvedValue({
        limits: { "limit.maxProducts": 2 },
      });
      (prisma.product.count as any).mockResolvedValue(1);
      (prisma.category.findMany as any).mockResolvedValue([{ id: "c1", name: "İçecekler" }]);
      (prisma.product.findFirst as any).mockResolvedValue({
        id: "p1",
        tenantId: TENANT,
        name: "Kola",
        category: { name: "İçecekler" },
      });
      products.create.mockResolvedValue({ id: "new-1" });

      const s = await svc.commitDraft(
        {
          categories: [
            {
              name: "İçecekler",
              products: [
                { name: "Ayran", price: 25, onConflict: "SKIP", existingProductId: "p1" },
                { name: "Kola", price: 30, onConflict: "UPDATE_PRICE", existingProductId: "p1" },
                { name: "Limonata", price: 35 },
              ],
            },
          ],
        } as any,
        TENANT,
      );

      expect(products.create).toHaveBeenCalledTimes(1);
      expect(s.productsCreated).toBe(1);
      expect(s.productsSkipped).toBe(1);
      expect(s.productsUpdated).toBe(1);
    });
  });

  it("askClaude posts the given blocks and joins text parts", async () => {
    config.get.mockImplementation((k: string) =>
      k === "ANTHROPIC_API_KEY" ? "key1" : undefined,
    );
    (axios.post as jest.Mock).mockResolvedValue({
      data: { content: [{ type: "text", text: "a" }, { type: "other" }, { type: "text", text: "b" }] },
    });

    const out = await (svc as any).askClaude(
      [{ type: "text", text: "BLOCK" }],
      "PROMPT",
    );

    expect(out).toBe("a\nb");
    const [url, body, opts] = (axios.post as jest.Mock).mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(body.messages[0].content).toEqual([
      { type: "text", text: "BLOCK" },
      { type: "text", text: "PROMPT" },
    ]);
    expect(opts.headers["anthropic-version"]).toBe("2023-06-01");
    expect(opts.timeout).toBe(120_000);
  });

  describe("public seams for MenuSourceService (parseTextToDraft / parseDocumentToDraft / parseColumnMap)", () => {
    beforeEach(() => {
      config.get.mockImplementation((k: string) =>
        k === "ANTHROPIC_API_KEY" ? "sk-test" : undefined,
      );
    });

    it("parseTextToDraft sends a text block and normalises the answer, without touching quota", async () => {
      (axios.post as jest.Mock).mockResolvedValue({
        data: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                categories: [{ name: "İçecekler", products: [{ name: "Ayran", price: 25 }] }],
              }),
            },
          ],
        },
      });

      const draft = await svc.parseTextToDraft("Ayran 25 TL");

      expect(draft.categories[0].name).toBe("İçecekler");
      const [, body] = (axios.post as jest.Mock).mock.calls[0];
      expect(body.messages[0].content[0]).toEqual({ type: "text", text: "Ayran 25 TL" });
      expect((svc as any).quota.claim).not.toHaveBeenCalled();
      expect((svc as any).quota.voidUsage).not.toHaveBeenCalled();
    });

    it("parseDocumentToDraft sends a base64 document block with the given media type", async () => {
      (axios.post as jest.Mock).mockResolvedValue({
        data: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                categories: [{ name: "PDF", products: [{ name: "Kebap", price: 180 }] }],
              }),
            },
          ],
        },
      });

      const draft = await svc.parseDocumentToDraft(Buffer.from("%PDF-1.7"), "application/pdf");

      expect(draft.categories[0].products[0]).toMatchObject({ name: "Kebap", price: 180 });
      const [, body] = (axios.post as jest.Mock).mock.calls[0];
      expect(body.messages[0].content[0]).toEqual({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: Buffer.from("%PDF-1.7").toString("base64"),
        },
      });
    });

    it("parseColumnMap returns the parsed JSON mapping without routing through normaliseDraft", async () => {
      (axios.post as jest.Mock).mockResolvedValue({
        data: {
          content: [
            {
              type: "text",
              text: '```json\n{"name":"Ürün Kodu","price":"Bedel","category":null}\n```',
            },
          ],
        },
      });

      const map = await svc.parseColumnMap("Ürün Kodu | Bedel\nAyran | 25", "PROMPT");

      expect(map).toEqual({ name: "Ürün Kodu", price: "Bedel", category: null });
      const [, body] = (axios.post as jest.Mock).mock.calls[0];
      expect(body.messages[0].content).toEqual([
        { type: "text", text: "Ürün Kodu | Bedel\nAyran | 25" },
        { type: "text", text: "PROMPT" },
      ]);
    });

    it("parseColumnMap throws a clear error when the model returns no JSON object", async () => {
      (axios.post as jest.Mock).mockResolvedValue({
        data: { content: [{ type: "text", text: "sorry, I cannot help" }] },
      });

      await expect(svc.parseColumnMap("sample", "PROMPT")).rejects.toThrow(
        /column mapping/i,
      );
    });

    it("parseColumnMap throws the same clear error on braced-but-invalid JSON, instead of a bare SyntaxError", async () => {
      (axios.post as jest.Mock).mockResolvedValue({
        // Unquoted key — valid-looking braces, invalid JSON.
        data: { content: [{ type: "text", text: '{name: "Ürün Kodu", price: "Bedel"}' }] },
      });

      await expect(svc.parseColumnMap("sample", "PROMPT")).rejects.toThrow(
        /column mapping/i,
      );
    });

    it("parseTextToDraft's failure message talks about the source, not a photo", async () => {
      (axios.post as jest.Mock).mockResolvedValue({
        data: { content: [{ type: "text", text: "not JSON at all" }] },
      });

      await expect(svc.parseTextToDraft("some page text")).rejects.toThrow(
        /could not read a menu from that source/i,
      );
      await expect(svc.parseTextToDraft("some page text")).rejects.not.toThrow(/photo|well-lit/i);
    });

    it("parseDocumentToDraft's 'no items found' message talks about the source, not a photo", async () => {
      (axios.post as jest.Mock).mockResolvedValue({
        data: {
          content: [{ type: "text", text: JSON.stringify({ categories: [] }) }],
        },
      });

      await expect(
        svc.parseDocumentToDraft(Buffer.from("%PDF-1.7"), "application/pdf"),
      ).rejects.toThrow(/no menu items were found at that source/i);
    });

    it("parseMenuPhotos keeps the original photo-specific wording (default source label unchanged)", async () => {
      (axios.post as jest.Mock).mockResolvedValue({
        data: { content: [{ type: "text", text: "not JSON at all" }] },
      });

      await expect(
        svc.parseMenuPhotos("t1", [{ buffer: Buffer.from("img"), mimetype: "image/jpeg" }]),
      ).rejects.toThrow(/clearer, well-lit image/i);
    });
  });
});
