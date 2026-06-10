import { ConfigService } from '@nestjs/config';
import { HttpCoreProvisioningClient } from './http-core-provisioning.client';
import {
  CoreProvisioningEmailInUseError,
  CoreProvisioningError,
  CoreProvisioningPlanInvalidError,
  CoreProvisioningSubdomainError,
} from '../core-contracts/provisioning/tenant-provisioning.types';
import { INTERNAL_PROVISIONING_ROUTES } from '../core-contracts/provisioning/http-contract';

/**
 * Wire-contract tests for the marketing → core provisioning client against
 * the canonical HTTP contract (core-contracts/provisioning/http-contract):
 * every call is POST + JSON to the shared route constants, every success is
 * a 200 envelope (`{ leads }`, `{ plan | null }`), and a 404 is ALWAYS a
 * real error (the old allow404AsNull hack is gone — "unknown plan" travels
 * as `{ plan: null }`, not as a status code).
 */
describe('HttpCoreProvisioningClient', () => {
  const fetchMock = jest.fn();
  let client: HttpCoreProvisioningClient;

  const jsonResponse = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });

  beforeEach(() => {
    fetchMock.mockReset();
    (global as Record<string, unknown>).fetch = fetchMock;
    const config = {
      get: (key: string) =>
        ({
          CORE_SERVICE_URL: 'http://core:3000',
          INTERNAL_SERVICE_TOKEN: 'secret-token',
        })[key],
    } as unknown as ConfigService;
    client = new HttpCoreProvisioningClient(config);
  });

  const command = {
    leadId: 'l-1',
    idempotencyKey: 'lead-convert:l-1',
    tenantName: 'Acme',
    admin: { email: 'a@b.c', firstName: 'A', lastName: 'B' },
    plan: null,
  };

  describe('provisionTenantForLead', () => {
    it('POSTs the canonical route with the command body and token header', async () => {
      const result = { tenantId: 't-1', created: true };
      fetchMock.mockResolvedValue(jsonResponse(200, result));

      await expect(client.provisionTenantForLead(command)).resolves.toEqual(
        result,
      );

      expect(fetchMock).toHaveBeenCalledWith(
        `http://core:3000/api/${INTERNAL_PROVISIONING_ROUTES.provisionTenantForLead}`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'x-internal-token': 'secret-token',
          }),
          body: JSON.stringify(command),
        }),
      );
    });
  });

  describe('listProvisionedLeads', () => {
    it('POSTs {createdAfter, createdBefore} as ISO strings and unwraps { leads }', async () => {
      const leads = [{ leadId: 'l-1', tenantId: 't-1', planFacts: null }];
      fetchMock.mockResolvedValue(jsonResponse(200, { leads }));

      const after = new Date('2026-06-01T00:00:00.000Z');
      const before = new Date('2026-06-02T00:00:00.000Z');
      await expect(
        client.listProvisionedLeads(after, before),
      ).resolves.toEqual(leads);

      expect(fetchMock).toHaveBeenCalledWith(
        `http://core:3000/api/${INTERNAL_PROVISIONING_ROUTES.listProvisionedLeads}`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            createdAfter: '2026-06-01T00:00:00.000Z',
            createdBefore: '2026-06-02T00:00:00.000Z',
          }),
        }),
      );
    });

    it('degrades a missing envelope to an empty list', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, null));
      await expect(
        client.listProvisionedLeads(new Date(), new Date()),
      ).resolves.toEqual([]);
    });
  });

  describe('describePlan', () => {
    it('POSTs { planId } and unwraps the { plan } envelope', async () => {
      const plan = {
        planCode: 'PRO',
        planName: 'Profesyonel',
        monthlyPrice: 499,
        currency: 'TRY',
      };
      fetchMock.mockResolvedValue(jsonResponse(200, { plan }));

      await expect(client.describePlan('plan-1')).resolves.toEqual(plan);

      expect(fetchMock).toHaveBeenCalledWith(
        `http://core:3000/api/${INTERNAL_PROVISIONING_ROUTES.describePlan}`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ planId: 'plan-1' }),
        }),
      );
    });

    it('returns null for { plan: null } (unknown plan, still 200)', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { plan: null }));
      await expect(client.describePlan('nope')).resolves.toBeNull();
    });

    it('treats a 404 as a real error now (no allow404AsNull)', async () => {
      fetchMock.mockResolvedValue(jsonResponse(404, {}));
      await expect(client.describePlan('plan-1')).rejects.toBeInstanceOf(
        CoreProvisioningError,
      );
    });
  });

  describe('error-code mapping', () => {
    it.each([
      [
        'EMAIL_IN_USE',
        409,
        { email: 'a@b.c' },
        CoreProvisioningEmailInUseError,
      ],
      ['PLAN_INVALID', 422, { planId: 'p-1' }, CoreProvisioningPlanInvalidError],
      ['SUBDOMAIN_UNAVAILABLE', 409, {}, CoreProvisioningSubdomainError],
    ])('maps %s onto the typed error', async (code, status, extra, errClass) => {
      fetchMock.mockResolvedValue(
        jsonResponse(status, { code, message: 'boom', ...extra }),
      );
      await expect(client.provisionTenantForLead(command)).rejects.toBeInstanceOf(
        errClass,
      );
    });

    it('falls back to CoreProvisioningError for unknown codes / bodies', async () => {
      fetchMock.mockResolvedValue(jsonResponse(500, { nope: true }));
      await expect(
        client.provisionTenantForLead(command),
      ).rejects.toBeInstanceOf(CoreProvisioningError);
    });

    it('wraps network failures in CoreProvisioningError', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(client.describePlan('p-1')).rejects.toBeInstanceOf(
        CoreProvisioningError,
      );
    });
  });
});
