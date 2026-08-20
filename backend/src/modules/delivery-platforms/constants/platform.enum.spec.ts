import {
  DeliveryPlatform,
  PlatformLogDirection,
  PlatformLogAction,
  PLATFORM_AVAILABILITY,
  AVAILABLE_DELIVERY_PLATFORMS,
} from "./platform.enum";

/**
 * Long-tail drift-guard for the delivery-platform enums. Values are
 * persisted in platform_logs + matched against adapter dispatch, so
 * value===name is load-bearing.
 */
describe("platform.enum", () => {
  const valueEqualsName = (e: Record<string, string>) =>
    Object.entries(e).forEach(([name, value]) => expect(value).toBe(name));

  it("uses value===name for the platform enums", () => {
    valueEqualsName(DeliveryPlatform);
    valueEqualsName(PlatformLogDirection);
    valueEqualsName(PlatformLogAction);
  });

  it("enumerates the supported delivery platforms", () => {
    expect(Object.values(DeliveryPlatform)).toEqual(
      expect.arrayContaining(["YEMEKSEPETI", "GETIR", "TRENDYOL", "MIGROS"]),
    );
  });

  it("keeps the order lifecycle log actions", () => {
    expect(PlatformLogAction.ORDER_RECEIVED).toBe("ORDER_RECEIVED");
    expect(PlatformLogAction.ORDER_CANCELLED).toBe("ORDER_CANCELLED");
    expect(PlatformLogAction.AUTH_REFRESH).toBe("AUTH_REFRESH");
  });

  it("carries SEMT as a coming-soon platform with no adapter", () => {
    // Being in the enum means "appears in the shop window", NOT "a config can
    // be opened". Semt has no adapter, no webhook route and no credentials.
    expect(DeliveryPlatform.SEMT).toBe("SEMT");
    expect(PLATFORM_AVAILABILITY[DeliveryPlatform.SEMT]).toBe("coming_soon");
    expect(AVAILABLE_DELIVERY_PLATFORMS).not.toContain(DeliveryPlatform.SEMT);
    expect(AVAILABLE_DELIVERY_PLATFORMS).toEqual([
      "YEMEKSEPETI",
      "GETIR",
      "TRENDYOL",
      "MIGROS",
    ]);
  });

  it("declares availability for every enum member (no silent gap)", () => {
    // A member with no entry would read `undefined`, which the factory gate
    // treats as "not in the map" and lets straight through to the switch.
    for (const p of Object.values(DeliveryPlatform)) {
      expect(PLATFORM_AVAILABILITY[p]).toBeDefined();
    }
    expect(Object.isFrozen(PLATFORM_AVAILABILITY)).toBe(true);
  });
});
