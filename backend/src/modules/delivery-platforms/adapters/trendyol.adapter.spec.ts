import { ConfigService } from "@nestjs/config";
import { DeliveryPlatformConfig } from "@prisma/client";
import { DeliveryPlatform } from "../constants/platform.enum";
import { TrendyolAdapter } from "./trendyol.adapter";

/**
 * Pure-logic locks for the REAL TrendyolAdapter (the delivery service specs
 * mock adapterFactory.getAdapter, so this class's own mapping never ran).
 *
 * Covered:
 *  - normalizeOrder / parseWebhookOrder: raw payload -> NormalizedOrder field
 *    mapping, including every fallback branch (products|items, productId|id,
 *    name|productName, quantity|count, options|extras, id|orderId, etc.).
 *  - auth-header selection: v2 -> Bearer, deprecated -> Basic.
 *
 * NOTE ON MONEY: Trendyol's normalizeOrder passes money fields through
 * UNCHANGED (no kuruş/cents division — unlike Getir). These tests lock that
 * actual behaviour, not an assumed conversion.
 */
describe("TrendyolAdapter", () => {
  let adapter: TrendyolAdapter;

  // A bare ConfigService stub: .get() returns undefined so the constructor's
  // overrideBaseURL is a no-op and the default baseURL is kept.
  const configService = {
    get: jest.fn().mockReturnValue(undefined),
  } as unknown as ConfigService;

  beforeEach(() => {
    adapter = new TrendyolAdapter(configService);
  });

  const cfg = (over: Partial<DeliveryPlatformConfig> = {}) =>
    ({
      accessToken: "tok-abc",
      remoteRestaurantId: "rest-1",
      credentials: {},
      ...over,
    }) as unknown as DeliveryPlatformConfig;

  describe("parseWebhookOrder / normalizeOrder (primary fields)", () => {
    it("maps a fully-populated v2 webhook payload to NormalizedOrder", () => {
      const raw = {
        id: "TY-1001",
        customerName: "Ada Lovelace",
        customerPhone: "+90 555 111 22 33",
        deliveryAddress: "Kadikoy, Istanbul",
        customerNote: "Ring the bell",
        products: [
          {
            productId: "p-1",
            name: "Adana Kebap",
            quantity: 2,
            unitPrice: 18000,
            note: "spicy",
            options: [
              { name: "Extra ayran", price: 2500, quantity: 1 },
              { name: "Lavash", price: 0, quantity: 3 },
            ],
          },
        ],
        totalPrice: 38500,
        discountAmount: 1500,
        payableAmount: 37000,
        createdDate: "2026-06-14T10:00:00.000Z",
      };

      const result = adapter.parseWebhookOrder(raw);

      expect(result.platform).toBe(DeliveryPlatform.TRENDYOL);
      expect(result.externalOrderId).toBe("TY-1001");
      expect(result.customerName).toBe("Ada Lovelace");
      expect(result.customerPhone).toBe("+90 555 111 22 33");
      expect(result.customerAddress).toBe("Kadikoy, Istanbul");
      expect(result.notes).toBe("Ring the bell");

      expect(result.totalAmount).toBe(38500);
      expect(result.discount).toBe(1500);
      expect(result.finalAmount).toBe(37000);

      expect(result.rawPayload).toBe(raw);
      expect(result.createdAt).toEqual(new Date("2026-06-14T10:00:00.000Z"));

      expect(result.items).toHaveLength(1);
      const item = result.items[0];
      expect(item.externalItemId).toBe("p-1");
      expect(item.name).toBe("Adana Kebap");
      expect(item.quantity).toBe(2);
      expect(item.unitPrice).toBe(18000);
      expect(item.notes).toBe("spicy");
      expect(item.modifiers).toEqual([
        { name: "Extra ayran", price: 2500, quantity: 1 },
        { name: "Lavash", price: 0, quantity: 3 },
      ]);
    });

    it("uses the nested customer.* / orderId / note fallback branches", () => {
      const raw = {
        orderId: "TY-2002",
        customer: {
          name: "Grace Hopper",
          phone: "555-9999",
          address: "Bug HQ",
        },
        note: "leave at door",
        items: [
          {
            id: "i-9",
            productName: "Lahmacun",
            count: 3,
            price: 9000,
            extras: [{ name: "Limon" }],
          },
        ],
        totalAmount: 27000,
        discount: 0,
        finalAmount: 27000,
      };

      const result = adapter.parseWebhookOrder(raw);

      expect(result.externalOrderId).toBe("TY-2002");
      expect(result.customerName).toBe("Grace Hopper");
      expect(result.customerPhone).toBe("555-9999");
      expect(result.customerAddress).toBe("Bug HQ");
      expect(result.notes).toBe("leave at door");
      expect(result.totalAmount).toBe(27000);
      expect(result.finalAmount).toBe(27000);
      // createdDate absent -> createdAt undefined.
      expect(result.createdAt).toBeUndefined();

      const item = result.items[0];
      // products absent -> items[] used.
      expect(item.externalItemId).toBe("i-9");
      // name absent -> productName.
      expect(item.name).toBe("Lahmacun");
      // quantity absent -> count.
      expect(item.quantity).toBe(3);
      // unitPrice absent -> price.
      expect(item.unitPrice).toBe(9000);
      // options absent -> extras; opt.price absent -> 0; opt.quantity absent -> 1.
      expect(item.modifiers).toEqual([{ name: "Limon", price: 0, quantity: 1 }]);
    });

    it("applies numeric zero defaults for missing money + quantity and empty items", () => {
      const raw = {
        id: "TY-empty",
        products: [{ productId: "p-x" }],
      };

      const result = adapter.parseWebhookOrder(raw);

      expect(result.totalAmount).toBe(0);
      expect(result.discount).toBe(0);
      // finalAmount: payable|final|totalPrice all absent -> 0.
      expect(result.finalAmount).toBe(0);

      const item = result.items[0];
      expect(item.externalItemId).toBe("p-x");
      expect(item.quantity).toBe(1);
      expect(item.unitPrice).toBe(0);
      expect(item.modifiers).toEqual([]);
    });

    it("falls back finalAmount to totalPrice when payable/final are absent", () => {
      const raw = { id: "TY-3", products: [], totalPrice: 5000 };
      const result = adapter.parseWebhookOrder(raw);
      expect(result.finalAmount).toBe(5000);
      expect(result.items).toEqual([]);
    });

    it("does NOT divide money by 100 (no kuruş conversion, unlike Getir)", () => {
      const raw = {
        id: "TY-money",
        products: [{ productId: "p", unitPrice: 12345 }],
        totalPrice: 99999,
      };
      const result = adapter.parseWebhookOrder(raw);
      expect(result.totalAmount).toBe(99999);
      expect(result.items[0].unitPrice).toBe(12345);
    });
  });

  describe("auth-header selection (getTrendyolAuthHeaders via acceptOrder)", () => {
    // request() is protected; replace it so we can capture headers without HTTP.
    let captured: any;
    beforeEach(() => {
      captured = undefined;
      jest
        .spyOn(adapter as any, "request")
        .mockImplementation(async (config: any) => {
          captured = config;
          return { data: {} } as any;
        });
    });

    it("uses Bearer auth for the v2 (webhook) integration", async () => {
      await adapter.acceptOrder(
        cfg({
          accessToken: "v2-token",
          credentials: { apiVersion: "v2" } as any,
        }),
        "o-1",
      );
      expect(captured.headers).toEqual({ Authorization: "Bearer v2-token" });
    });

    it("uses Basic auth for the deprecated (non-v2) integration", async () => {
      await adapter.acceptOrder(
        cfg({ accessToken: "basic-token", credentials: {} as any }),
        "o-1",
      );
      expect(captured.headers).toEqual({ Authorization: "Basic basic-token" });
    });
  });

  describe("authenticate", () => {
    it("v2: exchanges integrator credentials for a Bearer token with a ~50min TTL", async () => {
      jest
        .spyOn(adapter as any, "request")
        .mockResolvedValue({ data: { token: "fresh-token" } } as any);

      const before = Date.now();
      const result = await adapter.authenticate(
        cfg({
          credentials: {
            apiVersion: "v2",
            integratorId: "int-1",
            integratorSecret: "sec-1",
          } as any,
        }),
      );

      expect(result.token).toBe("fresh-token");
      const ttl = result.expiresAt.getTime() - before;
      // 50 minutes, allow a small execution slack.
      expect(ttl).toBeGreaterThan(49 * 60 * 1000);
      expect(ttl).toBeLessThanOrEqual(50 * 60 * 1000 + 1000);
    });

    it("deprecated: base64-encodes username:password as a Basic token with a ~24h TTL", async () => {
      const requestSpy = jest.spyOn(adapter as any, "request");

      const before = Date.now();
      const result = await adapter.authenticate(
        cfg({
          credentials: { username: "user", password: "pass" } as any,
        }),
      );

      // No network call for Basic auth.
      expect(requestSpy).not.toHaveBeenCalled();
      expect(result.token).toBe(
        Buffer.from("user:pass").toString("base64"),
      );
      const ttl = result.expiresAt.getTime() - before;
      expect(ttl).toBeGreaterThan(23 * 60 * 60 * 1000);
      expect(ttl).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 1000);
    });
  });
});
