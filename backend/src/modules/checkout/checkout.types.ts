// Mixed-cart input contract. One cart can carry any combination of plan
// changes, add-on purchases, hardware SKUs, and service line items.

export interface CartItemPlan {
  type: 'plan';
  // PlanCode resolves to a SubscriptionPlan.name (FREE|BASIC|PRO|BUSINESS) for
  // now. Once Plan-as-data lands in a separate model, this becomes a row id.
  code: string;
  billingCycle?: 'MONTHLY' | 'YEARLY';
  qty?: number;
}

export interface CartItemAddOn {
  type: 'addon';
  code: string;
  qty?: number;
  branchId?: string;
}

export interface CartItemHardware {
  type: 'hardware';
  sku: string;
  qty: number;
  // 'sell' (default) or 'rent' if the SKU offers a rental price.
  acquisition?: 'sell' | 'rent';
}

export interface CartItemService {
  type: 'service';
  // Service codes are simple identifiers: 'onsite_install_kds', 'training_4h', ...
  code: string;
  qty?: number;
  branchId?: string;
}

export type CartItem = CartItemPlan | CartItemAddOn | CartItemHardware | CartItemService;

export interface Cart {
  items: CartItem[];
  shippingAddress?: Record<string, unknown>;
  billingAddress?: Record<string, unknown>;
  couponCode?: string;
}

export interface PricedLine {
  type: CartItem['type'];
  code: string;
  name: string;
  qty: number;
  unitCents: number;
  subtotalCents: number;
  // Billed monthly|yearly|oneTime — drives the invoice rendering and the
  // recurring-vs-one-time split.
  cadence: 'monthly' | 'yearly' | 'oneTime';
  // Free-form metadata the checkout flow may need to wire up post-payment.
  meta?: Record<string, unknown>;
}

export interface CartQuote {
  lines: PricedLine[];
  currency: string;
  subtotalCents: number;
  taxCents: number;
  shippingCents: number;
  totalCents: number;
  warnings: string[];   // soft warnings — e.g. "addon X requires PRO plan"
  // True if the cart is purely recurring software (no hardware/service):
  // simplifies the success-page UX.
  isPureRecurring: boolean;
}
