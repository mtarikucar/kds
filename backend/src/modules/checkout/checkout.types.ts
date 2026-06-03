// Mixed-cart input contract. One cart can carry any combination of plan
// changes, add-on purchases, hardware SKUs, and service line items.

export interface CartItemPlan {
  type: "plan";
  // PlanCode resolves to a SubscriptionPlan.name (FREE|BASIC|PRO|BUSINESS) for
  // now. Once Plan-as-data lands in a separate model, this becomes a row id.
  code: string;
  billingCycle?: "MONTHLY" | "YEARLY";
  qty?: number;
}

export interface CartItemAddOn {
  type: "addon";
  code: string;
  qty?: number;
  branchId?: string;
}

export interface CartItemHardware {
  type: "hardware";
  sku: string;
  qty: number;
  // 'sell' (default) or 'rent' if the SKU offers a rental price.
  acquisition?: "sell" | "rent";
}

export interface CartItemService {
  type: "service";
  // v2.8.87: the `code` IS the SKU of a HardwareProduct row with
  // category: 'service'. The 2 hardcoded legacy codes
  // ('onsite_install_kds', 'training_4h') still resolve via the legacy
  // fallback for spec stability.
  code: string;
  qty?: number;
  branchId?: string;
  // v2.8.87: cart-time scheduling intent for on-site services.
  // CheckoutService reads these to populate InstallationRequest.
  // ISO date strings (YYYY-MM-DD), 1-3 entries. Optional — remote /
  // consultation services don't need them.
  preferredDates?: string[];
  // Free-form note from the buyer (delivery instructions, contact
  // person at the venue, etc.). Forwarded to InstallationRequest.notes.
  notes?: string;
}

export type CartItem =
  | CartItemPlan
  | CartItemAddOn
  | CartItemHardware
  | CartItemService;

export interface Cart {
  items: CartItem[];
  shippingAddress?: Record<string, unknown>;
  billingAddress?: Record<string, unknown>;
  couponCode?: string;
  // v2.8.99.3 — hardware-store "ship to my branch" reference.
  // Snapshot of which branch the buyer picked at intent time; the
  // address inside shippingAddress is copied separately so a branch
  // moving / archiving later doesn't rewrite this order's address.
  // Validated tenant-scoped + active in CheckoutService.confirmAndProvision.
  branchId?: string;
}

// Per-line metadata the QuoteService producer attaches and the
// CheckoutService consumer reads post-payment. Typed (instead of a bare
// Record) so a key rename between producer and consumer is caught by the
// compiler. All keys optional — which ones are present depends on the line
// `type` (plan: planId/billingCycle; addon: addOnId/kind/branchId; hardware:
// productId/acquisition/warrantyMonths; service: branchId/serviceMeta/
// preferredDates/notes).
export interface PricedLineMeta {
  planId?: string;
  billingCycle?: string;
  addOnId?: string;
  kind?: string;
  branchId?: string;
  productId?: string;
  acquisition?: "sell" | "rent";
  warrantyMonths?: number;
  serviceMeta?: Record<string, unknown> | null;
  // Regulatory tier snapshot on service lines (forwarded by QuoteService).
  saleMode?: string;
  preferredDates?: string[];
  notes?: string;
}

export interface PricedLine {
  type: CartItem["type"];
  code: string;
  name: string;
  qty: number;
  unitCents: number;
  subtotalCents: number;
  // Billed monthly|yearly|oneTime — drives the invoice rendering and the
  // recurring-vs-one-time split.
  cadence: "monthly" | "yearly" | "oneTime";
  // Per-line metadata wired up post-payment (see PricedLineMeta).
  meta?: PricedLineMeta;
}

export interface CartQuote {
  lines: PricedLine[];
  currency: string;
  subtotalCents: number;
  taxCents: number;
  shippingCents: number;
  totalCents: number;
  warnings: string[]; // soft warnings — e.g. "addon X requires PRO plan"
  // True if the cart is purely recurring software (no hardware/service):
  // simplifies the success-page UX.
  isPureRecurring: boolean;
}
