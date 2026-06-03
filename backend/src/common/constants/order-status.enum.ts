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
