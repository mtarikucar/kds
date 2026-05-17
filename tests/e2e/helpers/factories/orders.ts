import { APIRequestContext } from '@playwright/test';

export type OrderType = 'DINE_IN' | 'TAKEAWAY' | 'COUNTER' | 'DELIVERY';
export type OrderStatus =
  | 'PENDING_APPROVAL'
  | 'PENDING'
  | 'PREPARING'
  | 'READY'
  | 'SERVED'
  | 'PAID'
  | 'CANCELLED';
export type PaymentMethod = 'CASH' | 'CARD' | 'DIGITAL';

export type OrderItemInput = {
  productId: string;
  quantity?: number;
  notes?: string;
};

export type OrderInput = {
  type?: OrderType;
  tableId?: string;
  customerName?: string;
  notes?: string;
  discount?: number;
  items: OrderItemInput[];
  idempotencyKey?: string;
};

/**
 * Order response shape. Money fields come back as decimal strings
 * (Prisma serializes `Decimal` to JSON-string by default) so call
 * `Number(order.finalAmount)` in assertions, never compare to a
 * numeric literal directly.
 */
export type OrderResult = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  type: OrderType;
  finalAmount: string;
  totalAmount: string;
  tenantId: string;
  tableId: string | null;
  orderItems: Array<{ id: string; productId: string; quantity: number; unitPrice: string }>;
};

export async function createOrder(
  api: APIRequestContext,
  input: OrderInput,
): Promise<OrderResult> {
  const payload = {
    type: input.type ?? (input.tableId ? 'DINE_IN' : 'TAKEAWAY'),
    tableId: input.tableId,
    customerName: input.customerName,
    notes: input.notes,
    discount: input.discount,
    items: input.items.map((i) => ({
      productId: i.productId,
      quantity: i.quantity ?? 1,
      notes: i.notes,
    })),
    idempotencyKey: input.idempotencyKey,
  };
  const res = await api.post('orders', { data: payload });
  if (!res.ok()) throw new Error(`createOrder failed: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function updateOrderStatus(
  api: APIRequestContext,
  orderId: string,
  status: OrderStatus,
): Promise<OrderResult> {
  const res = await api.patch(`orders/${orderId}/status`, { data: { status } });
  if (!res.ok())
    throw new Error(`updateOrderStatus failed: ${res.status()} ${await res.text()}`);
  return res.json();
}

/**
 * Walk an order from PENDING → PREPARING → READY → SERVED in one
 * call. Useful in payment specs that need a ready-to-pay order
 * without caring about the kitchen flow.
 */
export async function advanceOrderToServed(
  api: APIRequestContext,
  orderId: string,
): Promise<OrderResult> {
  await updateOrderStatus(api, orderId, 'PREPARING');
  await updateOrderStatus(api, orderId, 'READY');
  return updateOrderStatus(api, orderId, 'SERVED');
}

export async function approveOrder(api: APIRequestContext, orderId: string): Promise<OrderResult> {
  const res = await api.post(`orders/${orderId}/approve`);
  if (!res.ok()) throw new Error(`approveOrder failed: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function cancelOrder(api: APIRequestContext, orderId: string): Promise<void> {
  // CANCELLED is a status transition, not a delete. The DELETE
  // endpoint is reserved for cleanup of PENDING/CANCELLED rows.
  await updateOrderStatus(api, orderId, 'CANCELLED');
}

export type PaymentInput = {
  amount: number;
  method?: PaymentMethod;
  transactionId?: string;
  idempotencyKey?: string;
};

export type PaymentResult = {
  id: string;
  /** Decimal serialized as string — coerce with Number() in assertions. */
  amount: string;
  method: PaymentMethod;
  status: string;
};

export async function paySingle(
  api: APIRequestContext,
  orderId: string,
  input: PaymentInput,
): Promise<PaymentResult> {
  const payload = {
    amount: input.amount,
    method: input.method ?? 'CASH',
    transactionId: input.transactionId,
    idempotencyKey: input.idempotencyKey,
  };
  const res = await api.post(`orders/${orderId}/payments`, { data: payload });
  if (!res.ok()) throw new Error(`paySingle failed: ${res.status()} ${await res.text()}`);
  return res.json();
}

export type PayItemsInput = {
  items: Array<{ orderItemId: string; quantity: number }>;
  method?: PaymentMethod;
  idempotencyKey?: string;
};

/**
 * payByItems response wraps the payment plus per-item allocations and
 * a remaining-balance breakdown. Tests usually want
 * `result.payment.amount` or `result.orderFullyPaid`.
 */
export type PayItemsResult = {
  payment: PaymentResult;
  itemAllocations: Array<{ orderItemId: string; quantity: number }>;
  orderFullyPaid: boolean;
  remaining: unknown;
};

export async function payByItems(
  api: APIRequestContext,
  orderId: string,
  input: PayItemsInput,
): Promise<PayItemsResult> {
  const payload = {
    items: input.items,
    method: input.method ?? 'CASH',
    idempotencyKey: input.idempotencyKey,
  };
  const res = await api.post(`orders/${orderId}/payments/items`, { data: payload });
  if (!res.ok()) throw new Error(`payByItems failed: ${res.status()} ${await res.text()}`);
  return res.json();
}
