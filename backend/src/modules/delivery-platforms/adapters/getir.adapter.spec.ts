import { ConfigService } from "@nestjs/config";
import { DeliveryPlatformConfig } from "@prisma/client";
import { DeliveryPlatform } from "../constants/platform.enum";
import { GetirAdapter } from "./getir.adapter";

/**
 * Pure-logic locks for the REAL GetirAdapter.
 *
 * Getir is the ONLY adapter that converts money: raw payloads are in kuruş
 * (cents), so normalizeOrder divides every money field by 100. These tests
 * assert the divided (major-unit) result so a regression that drops the /100
 * (or applies it twice) is caught.
 */
describe("GetirAdapter", () => {
  let adapter: GetirAdapter;

  const configService = {
    get: jest.fn().mockReturnValue(undefined),
  } as unknown as ConfigService;

  beforeEach(() => {
    adapter = new GetirAdapter(configService);
  });

  const cfg = (over: Partial<DeliveryPlatformConfig> = {}) =>
    ({
      accessToken: "getir-token",
      remoteRestaurantId: "rest-1",
      credentials: {},
      ...over,
    }) as unknown as DeliveryPlatformConfig;

  // normalizeOrder is private; pollNewOrders is the public surface that runs it.
  const normalizeViaPoll = async (raw: any) => {
    jest
      .spyOn(adapter as any, "request")
      .mockResolvedValue({ data: [raw] } as any);
    const orders = await adapter.pollNewOrders(cfg());
    return orders[0];
  };

  describe("normalizeOrder (kuruş -> major unit conversion)", () => {
    it("maps a full Getir order and divides every money field by 100", async () => {
      const raw = {
        id: "GTR-500",
        client: {
          name: "Linus",
          clientPhoneNumber: "555-0001",
          deliveryAddress: { address: "Tux Street 1" },
        },
        clientNote: "no onions",
        products: [
          {
            productId: "gp-1",
            name: "Burger",
            count: 2,
            price: 12000, // 120.00
            note: "well done",
            optionCategories: [
              {
                options: [
                  { name: "Cheese", price: 1500, count: 1 }, // 15.00
                  { name: "Bacon", price: 2000, count: 2 }, // 20.00
                ],
              },
            ],
          },
        ],
        totalPrice: 26000, // 260.00
        discountTotal: 5000, // 50.00
        createdAt: "2026-06-14T09:30:00.000Z",
      };

      const order = await normalizeViaPoll(raw);

      expect(order.platform).toBe(DeliveryPlatform.GETIR);
      expect(order.externalOrderId).toBe("GTR-500");
      expect(order.customerName).toBe("Linus");
      expect(order.customerPhone).toBe("555-0001");
      expect(order.customerAddress).toBe("Tux Street 1");
      expect(order.notes).toBe("no onions");

      // 26000/100 ; 5000/100 ; (26000-5000)/100
      expect(order.totalAmount).toBe(260);
      expect(order.discount).toBe(50);
      expect(order.finalAmount).toBe(210);
      expect(order.rawPayload).toBe(raw);
      expect(order.createdAt).toEqual(new Date("2026-06-14T09:30:00.000Z"));

      const item = order.items[0];
      expect(item.externalItemId).toBe("gp-1");
      expect(item.name).toBe("Burger");
      expect(item.quantity).toBe(2);
      expect(item.unitPrice).toBe(120); // 12000/100
      expect(item.notes).toBe("well done");
      // Modifiers are flattened across optionCategories and also /100.
      expect(item.modifiers).toEqual([
        { name: "Cheese", price: 15, quantity: 1 },
        { name: "Bacon", price: 20, quantity: 2 },
      ]);
    });

    it("applies id/quantity/price fallbacks and zero-defaults safely", async () => {
      const raw = {
        id: "GTR-min",
        products: [
          { id: "gp-fallback" }, // productId absent -> id
        ],
        // totalPrice / discountTotal absent -> 0
      };

      const order = await normalizeViaPoll(raw);

      expect(order.totalAmount).toBe(0);
      expect(order.discount).toBe(0);
      expect(order.finalAmount).toBe(0);
      // client absent -> customer fields undefined (optional chaining).
      expect(order.customerName).toBeUndefined();
      expect(order.customerPhone).toBeUndefined();
      expect(order.customerAddress).toBeUndefined();
      expect(order.createdAt).toBeUndefined();

      const item = order.items[0];
      expect(item.externalItemId).toBe("gp-fallback");
      expect(item.quantity).toBe(1); // count|quantity absent -> 1
      expect(item.unitPrice).toBe(0); // price absent -> 0
      expect(item.modifiers).toEqual([]); // optionCategories absent -> []
    });

    it("returns an empty item list when products is absent", async () => {
      const order = await normalizeViaPoll({ id: "GTR-noitems" });
      expect(order.items).toEqual([]);
    });

    it("computes finalAmount as (total - discount)/100, not total/100 - discount", async () => {
      const order = await normalizeViaPoll({
        id: "GTR-fa",
        products: [],
        totalPrice: 10000,
        discountTotal: 2500,
      });
      // (10000 - 2500) / 100 = 75
      expect(order.finalAmount).toBe(75);
    });
  });

  describe("authenticate", () => {
    it("logs in with the app/restaurant secret keys and returns a ~55min TTL token", async () => {
      const requestSpy = jest
        .spyOn(adapter as any, "request")
        .mockResolvedValue({ data: { token: "g-token" } } as any);

      const before = Date.now();
      const result = await adapter.authenticate(
        cfg({
          credentials: {
            appSecretKey: "app-k",
            restaurantSecretKey: "rest-k",
          } as any,
        }),
      );

      expect(result.token).toBe("g-token");
      const sent = requestSpy.mock.calls[0][0] as any;
      expect(sent.url).toBe("/auth/login");
      expect(sent.data).toEqual({
        appSecretKey: "app-k",
        restaurantSecretKey: "rest-k",
      });
      const ttl = result.expiresAt.getTime() - before;
      expect(ttl).toBeGreaterThan(54 * 60 * 1000);
      expect(ttl).toBeLessThanOrEqual(55 * 60 * 1000 + 1000);
    });
  });
});
