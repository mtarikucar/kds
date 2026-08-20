export enum DeliveryPlatform {
  YEMEKSEPETI = "YEMEKSEPETI",
  GETIR = "GETIR",
  TRENDYOL = "TRENDYOL",
  MIGROS = "MIGROS",
  /** Bağımsız teslimat platformu. Adaptörü YOK — availability ile kapalı. */
  SEMT = "SEMT",
}

export type PlatformAvailability = "available" | "coming_soon";

/**
 * Whether a platform has a WORKING adapter. Every `coming_soon` platform is
 * REFUSED on every write/execute path: being in the enum means "appears in the
 * shop window", not "a config can be opened".
 */
export const PLATFORM_AVAILABILITY: Readonly<
  Record<DeliveryPlatform, PlatformAvailability>
> = Object.freeze({
  [DeliveryPlatform.YEMEKSEPETI]: "available",
  [DeliveryPlatform.GETIR]: "available",
  [DeliveryPlatform.TRENDYOL]: "available",
  [DeliveryPlatform.MIGROS]: "available",
  [DeliveryPlatform.SEMT]: "coming_soon",
});

export const AVAILABLE_DELIVERY_PLATFORMS: readonly DeliveryPlatform[] =
  Object.values(DeliveryPlatform).filter(
    (p) => PLATFORM_AVAILABILITY[p] === "available",
  );

/**
 * NOTE: returns false for an UNKNOWN string too (`undefined !== "available"`).
 * That is deliberate, but callers must not confuse it with "coming soon" — the
 * factory gate narrows with `platform in PLATFORM_AVAILABILITY` for exactly
 * this reason.
 */
export function isPlatformAvailable(platform: string): boolean {
  return PLATFORM_AVAILABILITY[platform as DeliveryPlatform] === "available";
}

export enum PlatformLogDirection {
  INBOUND = "INBOUND",
  OUTBOUND = "OUTBOUND",
}

export enum PlatformLogAction {
  ORDER_RECEIVED = "ORDER_RECEIVED",
  ORDER_ACCEPTED = "ORDER_ACCEPTED",
  ORDER_REJECTED = "ORDER_REJECTED",
  ORDER_PREPARING = "ORDER_PREPARING",
  ORDER_READY = "ORDER_READY",
  ORDER_PICKED_UP = "ORDER_PICKED_UP",
  ORDER_CANCELLED = "ORDER_CANCELLED",
  ORDER_REFUNDED = "ORDER_REFUNDED",
  ORDER_AMENDED = "ORDER_AMENDED",
  STATUS_UPDATE = "STATUS_UPDATE",
  AUTH_REFRESH = "AUTH_REFRESH",
  MENU_SYNC = "MENU_SYNC",
  ITEM_AVAILABILITY = "ITEM_AVAILABILITY",
  RESTAURANT_OPEN = "RESTAURANT_OPEN",
  RESTAURANT_CLOSE = "RESTAURANT_CLOSE",
  CONNECTION_TEST = "CONNECTION_TEST",
  ORDER_POLL = "ORDER_POLL",
}
