import { APIRequestContext } from '@playwright/test';

/**
 * Test factories for the marketing module. Each factory POSTs through
 * the public marketing API exactly as a client would; the auth context
 * is supplied by the caller (`loginAsMarketing()`). Defaults stamp a
 * `Date.now()` suffix so concurrent reruns don't collide on the
 * email-dedup guard.
 */

const uniq = () => Date.now() + Math.floor(Math.random() * 1000);

export interface Lead {
  id: string;
  businessName: string;
  contactPerson: string;
  email?: string;
  phone?: string;
  status: string;
  assignedToId?: string | null;
  convertedTenantId?: string | null;
  [k: string]: unknown;
}

export interface CreateLeadInput {
  businessName?: string;
  contactPerson?: string;
  email?: string | null;
  phone?: string;
  businessType?: string;
  source?: string;
  priority?: string;
  city?: string;
  assignedToId?: string;
}

export async function createLead(
  api: APIRequestContext,
  overrides: CreateLeadInput = {},
): Promise<Lead> {
  const ts = uniq();
  const payload = {
    businessName: overrides.businessName ?? `E2E Biz ${ts}`,
    contactPerson: overrides.contactPerson ?? 'E2E Owner',
    // `null` opts the email out entirely (for tests that need
    // phone-only leads); undefined falls through to the unique default.
    ...(overrides.email === null
      ? {}
      : { email: overrides.email ?? `e2e-lead-${ts}@example.com` }),
    phone: overrides.phone ?? `+9055${String(ts).slice(-9).padStart(9, '0')}`,
    businessType: overrides.businessType ?? 'RESTAURANT',
    source: overrides.source ?? 'PHONE',
    priority: overrides.priority ?? 'MEDIUM',
    ...(overrides.city ? { city: overrides.city } : {}),
    ...(overrides.assignedToId ? { assignedToId: overrides.assignedToId } : {}),
  };
  const res = await api.post('marketing/leads', { data: payload });
  if (!res.ok()) {
    throw new Error(`createLead failed: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

export async function transitionLead(
  api: APIRequestContext,
  id: string,
  status: string,
  lostReason?: string,
): Promise<Lead> {
  const res = await api.patch(`marketing/leads/${id}/status`, {
    data: { status, ...(lostReason ? { lostReason } : {}) },
  });
  if (!res.ok()) {
    throw new Error(`transitionLead failed: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

export async function assignLead(
  api: APIRequestContext,
  id: string,
  assignedToId: string,
): Promise<Lead> {
  const res = await api.patch(`marketing/leads/${id}/assign`, {
    data: { assignedToId },
  });
  if (!res.ok()) {
    throw new Error(`assignLead failed: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

export interface CreateOfferInput {
  planId?: string;
  customPrice?: number;
  discount?: number;
  trialDays?: number;
  validUntil?: string;
  notes?: string;
}

export async function createOffer(
  api: APIRequestContext,
  leadId: string,
  overrides: CreateOfferInput = {},
): Promise<{ id: string; status: string; validUntil?: string; [k: string]: unknown }> {
  const res = await api.post('marketing/offers', {
    data: { leadId, ...overrides },
  });
  if (!res.ok()) {
    throw new Error(`createOffer failed: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

export async function markOfferSent(api: APIRequestContext, id: string) {
  return api.patch(`marketing/offers/${id}/send`);
}

export interface CreateTaskInput {
  title?: string;
  description?: string;
  type?: string;
  priority?: string;
  /** ISO datetime; defaults to 1h from now (passes the 5-min grace). */
  dueDate?: string;
  leadId?: string;
  assignedToId?: string;
}

export async function createTask(
  api: APIRequestContext,
  overrides: CreateTaskInput = {},
): Promise<{ id: string; status: string; dueDate: string; [k: string]: unknown }> {
  const ts = uniq();
  const dueDate =
    overrides.dueDate ?? new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const payload = {
    title: overrides.title ?? `E2E Task ${ts}`,
    type: overrides.type ?? 'FOLLOW_UP',
    priority: overrides.priority ?? 'MEDIUM',
    dueDate,
    ...(overrides.description ? { description: overrides.description } : {}),
    ...(overrides.leadId ? { leadId: overrides.leadId } : {}),
    ...(overrides.assignedToId ? { assignedToId: overrides.assignedToId } : {}),
  };
  const res = await api.post('marketing/tasks', { data: payload });
  if (!res.ok()) {
    throw new Error(`createTask failed: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

export async function completeTask(api: APIRequestContext, id: string) {
  return api.patch(`marketing/tasks/${id}/complete`);
}

export interface ConvertLeadInput {
  tenantName?: string;
  adminEmail?: string;
  adminFirstName?: string;
  adminLastName?: string;
  adminPassword?: string;
  planId?: string;
  billingCycle?: string;
}

export async function convertLead(
  api: APIRequestContext,
  leadId: string,
  overrides: ConvertLeadInput = {},
) {
  const ts = uniq();
  const payload = {
    tenantName: overrides.tenantName ?? `E2E Tenant ${ts}`,
    adminEmail: overrides.adminEmail ?? `e2e-admin-${ts}@example.com`,
    adminFirstName: overrides.adminFirstName ?? 'E2E',
    adminLastName: overrides.adminLastName ?? 'Owner',
    adminPassword: overrides.adminPassword ?? 'Passw0rd!',
    ...(overrides.planId ? { planId: overrides.planId } : {}),
    ...(overrides.billingCycle ? { billingCycle: overrides.billingCycle } : {}),
  };
  return api.post(`marketing/leads/${leadId}/convert`, { data: payload });
}

export async function listCommissions(api: APIRequestContext) {
  const res = await api.get('marketing/commissions');
  if (!res.ok()) {
    throw new Error(`listCommissions failed: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

export async function listNotifications(
  api: APIRequestContext,
  query: { isRead?: boolean } = {},
): Promise<Array<{ id: string; type: string; title: string; message: string; isRead: boolean; metadata?: any }>> {
  const qs =
    query.isRead === undefined ? '' : `?isRead=${query.isRead ? 'true' : 'false'}`;
  const res = await api.get(`marketing/notifications${qs}`);
  if (!res.ok()) {
    throw new Error(`listNotifications failed: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

export async function getLead(api: APIRequestContext, id: string): Promise<Lead> {
  const res = await api.get(`marketing/leads/${id}`);
  if (!res.ok()) {
    throw new Error(`getLead failed: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

export async function listLeadTasks(api: APIRequestContext, leadId: string) {
  const res = await api.get(`marketing/tasks?leadId=${leadId}`);
  if (!res.ok()) {
    throw new Error(`listLeadTasks failed: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}
