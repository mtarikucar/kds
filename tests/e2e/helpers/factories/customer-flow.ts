import { APIRequestContext, request } from '@playwright/test';
import { API_BASE } from '../api';

export type CustomerSession = {
  sessionId: string;
  expiresAt: string;
};

/**
 * Create an anonymous QR-menu session. No auth required (this is the
 * public endpoint the customer's phone calls when scanning the
 * table's QR). Throttled — keep test count low or expect 429.
 */
export async function createCustomerSession(
  tenantId: string,
  tableId?: string,
): Promise<CustomerSession> {
  const ctx = await request.newContext({ baseURL: API_BASE });
  try {
    const res = await ctx.post('customer-public/sessions', {
      data: { tenantId, tableId },
    });
    if (!res.ok())
      throw new Error(`createCustomerSession failed: ${res.status()} ${await res.text()}`);
    return res.json();
  } finally {
    await ctx.dispose();
  }
}

export type CustomerOrderItem = {
  productId: string;
  quantity?: number;
};

export type CustomerOrderResult = {
  id: string;
  orderNumber: string;
  status: string;
  sessionId: string;
  tenantId: string;
  finalAmount: string;
  orderItems: Array<{ id: string; productId: string; quantity: number }>;
};

export async function createCustomerOrder(
  sessionId: string,
  items: CustomerOrderItem[],
  opts: { tableId?: string; customerPhone?: string } = {},
): Promise<CustomerOrderResult> {
  const ctx = await request.newContext({ baseURL: API_BASE });
  try {
    const res = await ctx.post('customer-orders', {
      data: {
        sessionId,
        tableId: opts.tableId,
        customerPhone: opts.customerPhone,
        items: items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity ?? 1,
        })),
      },
    });
    if (!res.ok())
      throw new Error(`createCustomerOrder failed: ${res.status()} ${await res.text()}`);
    return res.json();
  } finally {
    await ctx.dispose();
  }
}

export type PayIntentResult = {
  merchantOid: string;
  paymentLink?: string;
  /** Amount in TRY (decimal string). */
  amount: string;
  status: string;
};

export async function createSelfPayIntent(
  sessionId: string,
  items: Array<{ orderId: string; orderItemId: string; quantity: number }>,
): Promise<PayIntentResult> {
  const ctx = await request.newContext({ baseURL: API_BASE });
  try {
    const res = await ctx.post(`customer-orders/sessions/${sessionId}/pay-intent`, {
      data: { items },
    });
    if (!res.ok())
      throw new Error(`createSelfPayIntent failed: ${res.status()} ${await res.text()}`);
    return res.json();
  } finally {
    await ctx.dispose();
  }
}

export async function getPayableItems(sessionId: string): Promise<unknown> {
  const ctx = await request.newContext({ baseURL: API_BASE });
  try {
    const res = await ctx.get(`customer-orders/sessions/${sessionId}/payable-items`);
    if (!res.ok())
      throw new Error(`getPayableItems failed: ${res.status()} ${await res.text()}`);
    return res.json();
  } finally {
    await ctx.dispose();
  }
}

export async function getPayStatus(
  sessionId: string,
  merchantOid: string,
): Promise<{ status: string; failureReason?: string }> {
  const ctx = await request.newContext({ baseURL: API_BASE });
  try {
    const res = await ctx.get(
      `customer-orders/sessions/${sessionId}/pay-status?merchantOid=${merchantOid}`,
    );
    if (!res.ok())
      throw new Error(`getPayStatus failed: ${res.status()} ${await res.text()}`);
    return res.json();
  } finally {
    await ctx.dispose();
  }
}
