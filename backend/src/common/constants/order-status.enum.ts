export enum OrderStatus {
  PENDING_APPROVAL = "PENDING_APPROVAL",
  PENDING = "PENDING",
  PREPARING = "PREPARING",
  READY = "READY",
  SERVED = "SERVED",
  PAID = "PAID",
  CANCELLED = "CANCELLED",
}

export enum OrderType {
  DINE_IN = "DINE_IN",
  TAKEAWAY = "TAKEAWAY",
  DELIVERY = "DELIVERY",
  COUNTER = "COUNTER",
}

export enum TableStatus {
  AVAILABLE = "AVAILABLE",
  OCCUPIED = "OCCUPIED",
  RESERVED = "RESERVED",
}

export enum PaymentMethod {
  CASH = "CASH",
  CARD = "CARD",
  DIGITAL = "DIGITAL",
  /**
   * House loss / write-off pseudo-method. Created ONLY by the
   * `POST /orders/:id/write-off` endpoint when a manager absorbs the
   * remaining balance (no-show, comp, dispute). Never selectable in
   * the customer-facing payment UIs; surfaces in the Z-report under
   * its own bucket so the operator can reconcile losses.
   */
  HOUSE = "HOUSE",

  // Meal-voucher (yemek çeki / yemek kartı) tenders. First-class TR tender
  // types so they reconcile as their own line in the payment-method breakdown
  // and the Z-report instead of collapsing into "CARD". Fiscally treated as a
  // card tender on the fiş (toFiscalTender), but tracked distinctly everywhere
  // amounts are grouped by method.
  MULTINET = "MULTINET",
  SODEXO = "SODEXO",
  EDENRED = "EDENRED", // Ticket Restaurant (Edenred)
  SETCARD = "SETCARD",
  METROPOL = "METROPOL",
}

/** Meal-voucher (yemek çeki/kartı) tender methods. */
export const MEAL_VOUCHER_METHODS: readonly PaymentMethod[] = [
  PaymentMethod.MULTINET,
  PaymentMethod.SODEXO,
  PaymentMethod.EDENRED,
  PaymentMethod.SETCARD,
  PaymentMethod.METROPOL,
];

/** True when a payment method is a meal-voucher tender. */
export function isMealVoucher(method: string): boolean {
  return (MEAL_VOUCHER_METHODS as readonly string[]).includes(method);
}

export enum PaymentStatus {
  PENDING = "PENDING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  REFUNDED = "REFUNDED",
}

export enum StockMovementType {
  IN = "IN",
  OUT = "OUT",
  ADJUSTMENT = "ADJUSTMENT",
}
