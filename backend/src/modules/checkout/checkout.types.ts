// Mixed-cart input contract. One cart can carry any combination of catalog
// products (licence, modules, integrations, capacity, credits), hardware SKUs
// and service line items.
//
// v3.3.0 removed `CartItemPlan`. Plans are retired, and the line type had
// already been hard-rejected by QuoteService since the day it was found to
// charge for a plan change that never applied. Keeping ONE `addon` line type
// whose behaviour is driven by the catalog row's `kind` is what lets the
// renewal cart be an ordinary multi-line cart with no special casing.

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

export type CartItem = CartItemAddOn | CartItemHardware | CartItemService;

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
  /**
   * Set when this cart settles a generated RenewalCycle, so settlement can
   * mark that cycle paid in the same transaction as the provisioning.
   */
  renewalCycleId?: string;
}

// Per-line metadata the QuoteService producer attaches and the
// CheckoutService consumer reads post-payment. Typed (instead of a bare
// Record) so a key rename between producer and consumer is caught by the
// compiler. All keys optional — which ones are present depends on the line
// `type` (plan: planId/billingCycle; addon: addOnId/kind/branchId; hardware:
// productId/acquisition/warrantyMonths; service: branchId/serviceMeta/
// preferredDates/notes).
export interface PricedLineMeta {
  addOnId?: string;
  /** Catalog kind: license | module | integration | capacity | credit | service. */
  kind?: string;
  branchId?: string;
  // --- annual lines (v3.3.0 proration) ---
  /** Catalog list price for a WHOLE cycle. `unitCents` is the prorated slice. */
  annualPriceCents?: number;
  /** full | prorated | rollForward — renders the invoice footnote. */
  prorationMode?: string;
  /** Days this charge actually covers. */
  proratedDays?: number;
  /** Length of the cycle it was prorated against — 365 or 366. */
  cycleDays?: number;
  /** ISO dates. The period the purchase provisions. */
  periodStart?: string;
  periodEnd?: string;
  /** Whether an active licence gates this product. */
  requiresLicense?: boolean;
  /**
   * Catalog prerequisites of this add-on, forwarded from the SAME catalog read
   * the price came from. Carried on the line so provisioning can be ordered
   * without opening another query inside the Serializable transaction.
   * Never persisted: tenant-invoice.service.ts:107-125 reads named fields only.
   */
  deps?: string[];
  // --- credit packs ---
  creditKind?: string;
  /** Units to mint, ALREADY multiplied by the line quantity. */
  creditUnits?: number;
  // --- hardware / service ---
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

// A line silently dropped from the quote (unpublished / not directly
// purchasable / unknown). Structured (code + ref) instead of a baked English
// string so the client can render a localized, name-bearing message — a raw
// "Hardware not purchasable: SKU-123" is useless to a Turkish operator.
export type QuoteWarningCode =
  | "addon_not_purchasable"
  | "hardware_not_purchasable"
  | "hardware_not_directly_purchasable"
  // Task 4 — soft, display-only signal: qty requested exceeds real
  // inventory (CatalogService.getAvailableStock). The LINE STAYS PRICED
  // (not dropped) so the buyer still sees the total; the actual payment
  // block is CheckoutIntentService.createIntent's HARDWARE_OUT_OF_STOCK
  // ConflictException, not this warning.
  | "hardware_out_of_stock"
  | "service_not_purchasable"
  | "service_not_directly_purchasable"
  | "unknown_service";

export interface QuoteWarning {
  code: QuoteWarningCode;
  // The dropped item's identifier — a hardware SKU or an add-on/service code.
  // The client resolves it to a product name where it can.
  ref: string;
}

export interface CartQuote {
  lines: PricedLine[];
  currency: string;
  subtotalCents: number;
  taxCents: number;
  shippingCents: number;
  totalCents: number;
  warnings: QuoteWarning[]; // soft warnings for silently-dropped cart lines
  // True if the cart is purely recurring software (no hardware/service):
  // simplifies the success-page UX.
  isPureRecurring: boolean;
}
