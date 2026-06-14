import {
  DeliveryPlatform,
  PlatformLogDirection,
  PlatformLogAction,
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
});
