import { ConfigService } from "@nestjs/config";
import { DeliveryPlatformConfig } from "@prisma/client";
import { DeliveryPlatform } from "../constants/platform.enum";
import { MigrosAdapter } from "./migros.adapter";

/**
 * Pure-logic locks for the REAL MigrosAdapter.
 *
 * Migros normalizeOrder is structurally close to Trendyol's (money passes
 * through unchanged) BUT differs in two ways that these tests pin down:
 *   - modifiers come from product.extras ONLY (no `options` fallback);
 *   - auth is header-key based (X-API-Key + X-Branch-Id) rather than
 *     Bearer/Basic Authorization.
 */
describe("MigrosAdapter", () => {
  let adapter: MigrosAdapter;

  const configService = {
    get: jest.fn().mockReturnValue(undefined),
  } as unknown as ConfigService;

  beforeEach(() => {
    adapter = new MigrosAdapter(configService);
  });

  const cfg = (over: Partial<DeliveryPlatformConfig> = {}) =>
    ({
      accessToken: "tok",
      remoteRestaurantId: "branch-77",
      credentials: { apiKey: "mig-key" },
      ...over,
    }) as unknown as DeliveryPlatformConfig;

  const normalizeViaPoll = async (raw: any) => {
    jest
      .spyOn(adapter as any, "request")
      .mockResolvedValue({ data: { orders: [raw] } } as any);
    const orders = await adapter.pollNewOrders(cfg());
    return orders[0];
  };

  describe("normalizeOrder", () => {
    it("maps a full Migros order with money passed through unchanged", async () => {
      const raw = {
        id: "MG-1",
        customerName: "Margaret",
        customerPhone: "555-7",
        deliveryAddress: "Migros Mah.",
        customerNote: "extra napkins",
        products: [
          {
            productId: "mp-1",
            name: "Pide",
            quantity: 2,
            unitPrice: 7500,
            note: "no cheese",
            extras: [{ name: "Ayran", price: 1000, quantity: 1 }],
          },
        ],
        totalPrice: 15000,
        discountAmount: 1000,
        payableAmount: 14000,
        createdDate: "2026-06-14T08:00:00.000Z",
      };

      const order = await normalizeViaPoll(raw);

      expect(order.platform).toBe(DeliveryPlatform.MIGROS);
      expect(order.externalOrderId).toBe("MG-1");
      expect(order.customerName).toBe("Margaret");
      expect(order.customerPhone).toBe("555-7");
      expect(order.customerAddress).toBe("Migros Mah.");
      expect(order.notes).toBe("extra napkins");
      expect(order.totalAmount).toBe(15000);
      expect(order.discount).toBe(1000);
      expect(order.finalAmount).toBe(14000);
      expect(order.createdAt).toEqual(new Date("2026-06-14T08:00:00.000Z"));

      const item = order.items[0];
      expect(item.externalItemId).toBe("mp-1");
      expect(item.name).toBe("Pide");
      expect(item.quantity).toBe(2);
      expect(item.unitPrice).toBe(7500);
      expect(item.notes).toBe("no cheese");
      expect(item.modifiers).toEqual([
        { name: "Ayran", price: 1000, quantity: 1 },
      ]);
    });

    it("uses items[] / id / productName / count / customer.* fallbacks", async () => {
      const raw = {
        orderId: "MG-2",
        customer: { name: "Alan", phone: "555-8", address: "Turing Sk." },
        note: "ring twice",
        items: [
          { id: "mi-9", productName: "Sucuk", count: 4, price: 2200 },
        ],
        totalAmount: 8800,
        finalAmount: 8800,
      };

      const order = await normalizeViaPoll(raw);

      expect(order.externalOrderId).toBe("MG-2");
      expect(order.customerName).toBe("Alan");
      expect(order.customerPhone).toBe("555-8");
      expect(order.customerAddress).toBe("Turing Sk.");
      expect(order.notes).toBe("ring twice");
      expect(order.totalAmount).toBe(8800);
      expect(order.finalAmount).toBe(8800);
      expect(order.createdAt).toBeUndefined();

      const item = order.items[0];
      expect(item.externalItemId).toBe("mi-9");
      expect(item.name).toBe("Sucuk");
      expect(item.quantity).toBe(4);
      expect(item.unitPrice).toBe(2200);
      // extras absent -> empty modifiers (Migros has NO options fallback).
      expect(item.modifiers).toEqual([]);
    });

    it("zero-defaults missing money and falls back finalAmount to totalPrice", async () => {
      const order = await normalizeViaPoll({
        id: "MG-3",
        products: [{ id: "p" }],
        totalPrice: 4000,
      });
      expect(order.totalAmount).toBe(4000);
      expect(order.discount).toBe(0);
      expect(order.finalAmount).toBe(4000);
      expect(order.items[0].quantity).toBe(1);
      expect(order.items[0].unitPrice).toBe(0);
    });

    it("reads orders from response.data directly when there is no .orders wrapper", async () => {
      jest
        .spyOn(adapter as any, "request")
        .mockResolvedValue({ data: [{ id: "MG-bare", products: [] }] } as any);
      const orders = await adapter.pollNewOrders(cfg());
      expect(orders).toHaveLength(1);
      expect(orders[0].externalOrderId).toBe("MG-bare");
    });
  });

  describe("authenticate", () => {
    it("returns the per-branch apiKey as a long-lived token (no network call)", async () => {
      const requestSpy = jest.spyOn(adapter as any, "request");
      const before = Date.now();

      const result = await adapter.authenticate(
        cfg({ credentials: { apiKey: "mig-key" } as any }),
      );

      expect(requestSpy).not.toHaveBeenCalled();
      expect(result.token).toBe("mig-key");
      // Effectively-never-expires: ~365 days.
      const ttl = result.expiresAt.getTime() - before;
      expect(ttl).toBeGreaterThan(364 * 24 * 60 * 60 * 1000);
    });
  });

  describe("auth headers (getMigrosHeaders via acceptOrder)", () => {
    it("sends X-API-Key + X-Branch-Id from credentials/remoteRestaurantId", async () => {
      let captured: any;
      jest
        .spyOn(adapter as any, "request")
        .mockImplementation(async (c: any) => {
          captured = c;
          return { data: {} } as any;
        });

      await adapter.acceptOrder(
        cfg({
          remoteRestaurantId: "branch-99",
          credentials: { apiKey: "k-2" } as any,
        }),
        "o-1",
      );

      expect(captured.headers).toEqual({
        "X-API-Key": "k-2",
        "X-Branch-Id": "branch-99",
      });
    });

    it("defaults X-Branch-Id to empty string when remoteRestaurantId is null", async () => {
      let captured: any;
      jest
        .spyOn(adapter as any, "request")
        .mockImplementation(async (c: any) => {
          captured = c;
          return { data: {} } as any;
        });

      await adapter.acceptOrder(
        cfg({
          remoteRestaurantId: null as any,
          credentials: { apiKey: "k-3" } as any,
        }),
        "o-1",
      );

      expect(captured.headers["X-Branch-Id"]).toBe("");
    });
  });
});
