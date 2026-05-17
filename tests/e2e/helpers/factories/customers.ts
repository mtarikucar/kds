import { APIRequestContext } from '@playwright/test';

export type CustomerInput = {
  name?: string;
  phone?: string;
  email?: string;
  notes?: string;
  birthday?: string;
};

export type CustomerResult = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
};

/**
 * Backend DTO requires `phone` (E.164-ish: +?[1-9]\d{7,14}). We mint a
 * unique +90 number from the timestamp so concurrent test runs don't
 * collide.
 */
export async function createCustomer(
  api: APIRequestContext,
  input: CustomerInput = {},
): Promise<CustomerResult> {
  const ts = Date.now().toString();
  const payload = {
    name: input.name ?? `E2E Müşteri ${ts}`,
    phone: input.phone ?? `+905${ts.slice(-9)}`,
    email: input.email,
    notes: input.notes,
    birthday: input.birthday,
  };
  const res = await api.post('customers', { data: payload });
  if (!res.ok()) throw new Error(`createCustomer failed: ${res.status()} ${await res.text()}`);
  return res.json();
}
