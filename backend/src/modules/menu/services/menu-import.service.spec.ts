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
  let products: { create: jest.Mock };
  let entitlements: { getForTenant: jest.Mock };
  let svc: MenuImportService;

  const TENANT = "t1";

  beforeEach(() => {
    prisma = mockPrismaClient();
    config = { get: jest.fn() };
    categories = { create: jest.fn() };
    products = { create: jest.fn() };
    entitlements = {
      getForTenant: jest.fn().mockResolvedValue({ limits: {} }),
    };
    svc = new MenuImportService(
      prisma as any,
      config as any,
      categories as any,
      products as any,
      entitlements as any,
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
        svc.parseMenuPhotos([{ buffer: Buffer.from("x"), mimetype: "image/png" }]),
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
      const draft = await svc.parseMenuPhotos([
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
      const draft = await svc.parseMenuPhotos([
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
      const draft = await svc.parseMenuPhotos([
        { buffer: Buffer.from("img"), mimetype: "image/webp" },
      ]);
      expect(draft.categories[0].products[0].price).toBe(0);
      expect(draft.categories[0].products[0].taxRate).toBeUndefined();
    });

    it("throws a friendly error when no JSON object is present", async () => {
      mockAnthropic("Sorry, I could not read the image.");
      await expect(
        svc.parseMenuPhotos([{ buffer: Buffer.from("img"), mimetype: "image/jpeg" }]),
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
});
