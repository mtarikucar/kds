import { ConfigService } from "@nestjs/config";
import { DeliveryPlatformConfig } from "@prisma/client";
import { DeliveryPlatform } from "../constants/platform.enum";
import { YemeksepetiAdapter } from "./yemeksepeti.adapter";

/**
 * Pure-logic locks for the REAL YemeksepetiAdapter.
 *
 * Yemeksepeti is webhook-driven, so parseWebhookOrder IS the mapping (there
 * is no private normalizeOrder). Distinctive branches pinned here:
 *   - externalOrderId: id | orderToken
 *   - name: productName | name   (note: productName preferred, unlike Trendyol)
 *   - finalAmount: paymentAmount | finalAmount | totalPrice | 0
 *   - NO createdAt field is emitted.
 *   - notes per-item: note | description.
 */
describe("YemeksepetiAdapter", () => {
  let adapter: YemeksepetiAdapter;

  const configService = {
    get: jest.fn().mockReturnValue(undefined),
  } as unknown as ConfigService;

  beforeEach(() => {
    adapter = new YemeksepetiAdapter(configService);
  });

  const cfg = (over: Partial<DeliveryPlatformConfig> = {}) =>
    ({
      accessToken: "ys-token",
      credentials: { clientId: "cid", clientSecret: "csec" },
      ...over,
    }) as unknown as DeliveryPlatformConfig;

  describe("parseWebhookOrder", () => {
    it("maps a full webhook payload to NormalizedOrder", () => {
      const raw = {
        id: "YS-100",
        customerName: "Edsger",
        customerPhone: "555-2",
        deliveryAddress: "Dijkstra Cd.",
        customerNote: "no rush",
        products: [
          {
            productId: "yp-1",
            productName: "Margherita",
            count: 1,
            unitPrice: 13000,
            note: "thin crust",
            options: [{ name: "Extra basil", price: 500, count: 2 }],
          },
        ],
        totalPrice: 13000,
        discountAmount: 1000,
        paymentAmount: 12000,
      };

      const order = adapter.parseWebhookOrder(raw);

      expect(order.platform).toBe(DeliveryPlatform.YEMEKSEPETI);
      expect(order.externalOrderId).toBe("YS-100");
      expect(order.customerName).toBe("Edsger");
      expect(order.customerPhone).toBe("555-2");
      expect(order.customerAddress).toBe("Dijkstra Cd.");
      expect(order.notes).toBe("no rush");
      expect(order.totalAmount).toBe(13000);
      expect(order.discount).toBe(1000);
      expect(order.finalAmount).toBe(12000);
      expect(order.rawPayload).toBe(raw);
      // Yemeksepeti webhook mapping does not emit createdAt.
      expect(order).not.toHaveProperty("createdAt");

      const item = order.items[0];
      expect(item.externalItemId).toBe("yp-1");
      expect(item.name).toBe("Margherita");
      expect(item.quantity).toBe(1);
      expect(item.unitPrice).toBe(13000);
      expect(item.notes).toBe("thin crust");
      expect(item.modifiers).toEqual([
        { name: "Extra basil", price: 500, quantity: 2 },
      ]);
    });

    it("uses orderToken / customer.* / items[] / id / name / description fallbacks", () => {
      const raw = {
        orderToken: "tok-abc",
        customer: { name: "Niklaus", phone: "555-3", address: "Wirth Sk." },
        note: "back door",
        items: [
          {
            id: "yi-2",
            name: "Calzone",
            quantity: 2,
            price: 9000,
            description: "spinach",
          },
        ],
        totalPrice: 18000,
        finalAmount: 18000,
      };

      const order = adapter.parseWebhookOrder(raw);

      // id absent -> orderToken
      expect(order.externalOrderId).toBe("tok-abc");
      expect(order.customerName).toBe("Niklaus");
      expect(order.customerPhone).toBe("555-3");
      expect(order.customerAddress).toBe("Wirth Sk.");
      expect(order.notes).toBe("back door");
      expect(order.totalAmount).toBe(18000);
      // paymentAmount absent -> finalAmount
      expect(order.finalAmount).toBe(18000);

      const item = order.items[0];
      // productId absent -> id
      expect(item.externalItemId).toBe("yi-2");
      // productName absent -> name
      expect(item.name).toBe("Calzone");
      // count absent -> quantity
      expect(item.quantity).toBe(2);
      // unitPrice absent -> price
      expect(item.unitPrice).toBe(9000);
      // note absent -> description
      expect(item.notes).toBe("spinach");
      // options absent -> empty modifiers
      expect(item.modifiers).toEqual([]);
    });

    it("zero-defaults money, defaults quantity to 1, and falls back finalAmount to totalPrice", () => {
      const order = adapter.parseWebhookOrder({
        id: "YS-min",
        products: [{ productId: "yp" }],
        totalPrice: 5000,
      });
      expect(order.totalAmount).toBe(5000);
      expect(order.discount).toBe(0);
      // paymentAmount & finalAmount absent -> totalPrice
      expect(order.finalAmount).toBe(5000);
      expect(order.items[0].quantity).toBe(1);
      expect(order.items[0].unitPrice).toBe(0);
    });

    it("returns an empty item list when neither products nor items is present", () => {
      const order = adapter.parseWebhookOrder({ id: "YS-noitems" });
      expect(order.items).toEqual([]);
      expect(order.finalAmount).toBe(0);
    });
  });

  describe("authenticate", () => {
    it("performs an OAuth client-credentials login and refreshes 5 min before expiry", async () => {
      const requestSpy = jest
        .spyOn(adapter as any, "request")
        .mockResolvedValue({
          data: { access_token: "ys-access", expires_in: 3600 },
        } as any);

      const before = Date.now();
      const result = await adapter.authenticate(
        cfg({
          credentials: { clientId: "cid", clientSecret: "csec" } as any,
        }),
      );

      const sent = requestSpy.mock.calls[0][0] as any;
      expect(sent.url).toBe("/v2/login");
      expect(sent.data).toEqual({
        grant_type: "client_credentials",
        client_id: "cid",
        client_secret: "csec",
      });
      expect(result.token).toBe("ys-access");
      // (3600 - 300) seconds from now.
      const ttl = result.expiresAt.getTime() - before;
      expect(ttl).toBeGreaterThan((3600 - 300 - 1) * 1000);
      expect(ttl).toBeLessThanOrEqual((3600 - 300) * 1000 + 1000);
    });

    it("falls back to a 3600s default lifetime when expires_in is absent", async () => {
      jest
        .spyOn(adapter as any, "request")
        .mockResolvedValue({ data: { access_token: "ys-access" } } as any);

      const before = Date.now();
      const result = await adapter.authenticate(cfg());
      const ttl = result.expiresAt.getTime() - before;
      // default 3600 - 300 = 3300s
      expect(ttl).toBeGreaterThan((3300 - 1) * 1000);
      expect(ttl).toBeLessThanOrEqual(3300 * 1000 + 1000);
    });
  });
});
