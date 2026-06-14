import {
  OrderStatus,
  OrderType,
  TableStatus,
  PaymentMethod,
  PaymentStatus,
  StockMovementType,
} from "./order-status.enum";

/**
 * Long-tail drift-guard for the order-domain enums. These values are
 * persisted to Postgres and matched against Prisma enums, so a typo where
 * the string value diverges from the member name would silently break
 * round-tripping. We pin value===name and the presence of the load-bearing
 * pseudo-members (HOUSE write-off, PENDING_APPROVAL).
 */
describe("order-status enums", () => {
  const valueEqualsName = (e: Record<string, string>) =>
    Object.entries(e).forEach(([name, value]) => expect(value).toBe(name));

  it("uses value===name for every order-domain enum (DB round-trip safety)", () => {
    valueEqualsName(OrderStatus);
    valueEqualsName(OrderType);
    valueEqualsName(TableStatus);
    valueEqualsName(PaymentMethod);
    valueEqualsName(PaymentStatus);
    valueEqualsName(StockMovementType);
  });

  it("keeps the load-bearing approval + write-off members", () => {
    expect(OrderStatus.PENDING_APPROVAL).toBe("PENDING_APPROVAL");
    expect(OrderStatus.CANCELLED).toBe("CANCELLED");
    // HOUSE is the manager write-off pseudo-method surfaced in Z-reports.
    expect(PaymentMethod.HOUSE).toBe("HOUSE");
  });
});
