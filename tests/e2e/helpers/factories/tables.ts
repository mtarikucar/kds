import { APIRequestContext } from '@playwright/test';

export type TableStatus = 'AVAILABLE' | 'OCCUPIED' | 'RESERVED';

export type TableInput = {
  number?: string;
  capacity?: number;
  section?: string;
  status?: TableStatus;
};

export type TableResult = {
  id: string;
  number: string;
  capacity: number;
  status: TableStatus;
};

export async function createTable(
  api: APIRequestContext,
  input: TableInput = {},
): Promise<TableResult> {
  const payload = {
    // Numeric-but-unique-ish: timestamp tail + random keeps inserts
    // from colliding on the (tenantId, number) unique index.
    number: input.number ?? `E2E-${Date.now().toString().slice(-6)}${Math.random().toString(36).slice(2, 4)}`,
    capacity: input.capacity ?? 4,
    section: input.section,
    status: input.status ?? 'AVAILABLE',
  };
  const res = await api.post('tables', { data: payload });
  if (!res.ok()) throw new Error(`createTable failed: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function setTableStatus(
  api: APIRequestContext,
  tableId: string,
  status: TableStatus,
): Promise<void> {
  const res = await api.patch(`tables/${tableId}/status`, { data: { status } });
  if (!res.ok()) throw new Error(`setTableStatus failed: ${res.status()} ${await res.text()}`);
}
