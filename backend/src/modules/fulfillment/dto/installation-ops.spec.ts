import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateInstallationRequestDto,
  CreateShipmentDto,
  FileWarrantyClaimDto,
} from './installation-ops.dto';

/**
 * Iter-61 regression — three fulfillment endpoints accepted inline
 * TypeScript shapes as @Body(), which the global ValidationPipe cannot
 * validate. branchId / hwOrderId flowed through as arbitrary strings,
 * preferredDates could be a 100-element array of "abc", notes could be
 * a multi-MB blob, the shipment meta blob could be a primitive or
 * string instead of a JSON object, etc. iter-61 converts them all to
 * typed DTO classes so ValidationPipe fires.
 */
describe('Fulfillment body DTOs (iter-61)', () => {
  async function errors(dto: object): Promise<string[]> {
    const results = await validate(dto);
    return results.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  describe('CreateInstallationRequestDto', () => {
    it('accepts an empty body (every field is optional)', async () => {
      expect(await errors(plainToInstance(CreateInstallationRequestDto, {}))).toEqual([]);
    });

    it('rejects non-UUID branchId', async () => {
      const dto = plainToInstance(CreateInstallationRequestDto, { branchId: 'not-a-uuid' });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /branchId/i.test(m))).toBe(true);
    });

    it('rejects non-UUID hwOrderId', async () => {
      const dto = plainToInstance(CreateInstallationRequestDto, { hwOrderId: 'not-a-uuid' });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /hwOrderId/i.test(m))).toBe(true);
    });

    it('rejects preferredDates array larger than 10', async () => {
      const dates = Array.from({ length: 11 }, (_, i) => `2026-06-${String(i + 1).padStart(2, '0')}T09:00:00.000Z`);
      const dto = plainToInstance(CreateInstallationRequestDto, { preferredDates: dates });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /preferredDates/i.test(m))).toBe(true);
    });

    it('rejects preferredDates with non-ISO entries', async () => {
      const dto = plainToInstance(CreateInstallationRequestDto, {
        preferredDates: ['2026-06-15T09:00:00.000Z', 'not-a-date'],
      });
      const all = await validate(dto);
      expect(all.length).toBeGreaterThan(0);
    });

    it('rejects notes longer than 2000 chars', async () => {
      const dto = plainToInstance(CreateInstallationRequestDto, { notes: 'x'.repeat(2001) });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /notes/i.test(m))).toBe(true);
    });

    it('accepts a typical payload', async () => {
      const dto = plainToInstance(CreateInstallationRequestDto, {
        branchId: '550e8400-e29b-41d4-a716-446655440000',
        hwOrderId: '550e8400-e29b-41d4-a716-446655440001',
        preferredDates: ['2026-06-15T09:00:00.000Z'],
        notes: 'Bring a ladder',
      });
      expect(await errors(dto)).toEqual([]);
    });
  });

  describe('FileWarrantyClaimDto', () => {
    it('requires issue', async () => {
      const dto = plainToInstance(FileWarrantyClaimDto, {});
      const msgs = await errors(dto);
      expect(msgs.some((m) => /issue/i.test(m))).toBe(true);
    });

    it('rejects issue shorter than 3 chars', async () => {
      const dto = plainToInstance(FileWarrantyClaimDto, { issue: 'ok' });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /issue/i.test(m))).toBe(true);
    });

    it('rejects severity outside the enum', async () => {
      const dto = plainToInstance(FileWarrantyClaimDto, { issue: 'broken', severity: 'critical' });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /severity/i.test(m))).toBe(true);
    });

    it('rejects description longer than 4000 chars', async () => {
      const dto = plainToInstance(FileWarrantyClaimDto, {
        issue: 'broken',
        description: 'x'.repeat(4001),
      });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /description/i.test(m))).toBe(true);
    });

    it('accepts a typical claim', async () => {
      const dto = plainToInstance(FileWarrantyClaimDto, {
        issue: 'screen flickers',
        severity: 'high',
        description: 'after 6 months',
      });
      expect(await errors(dto)).toEqual([]);
    });
  });

  describe('CreateShipmentDto', () => {
    it('requires carrier', async () => {
      const dto = plainToInstance(CreateShipmentDto, {});
      const msgs = await errors(dto);
      expect(msgs.some((m) => /carrier/i.test(m))).toBe(true);
    });

    it('rejects carrier longer than 64 chars', async () => {
      const dto = plainToInstance(CreateShipmentDto, { carrier: 'x'.repeat(65) });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /carrier/i.test(m))).toBe(true);
    });

    it('rejects trackingNo longer than 128 chars', async () => {
      const dto = plainToInstance(CreateShipmentDto, {
        carrier: 'manual',
        trackingNo: 'x'.repeat(129),
      });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /trackingNo/i.test(m))).toBe(true);
    });

    it('rejects meta when it is not an object (load-bearing JSONB shape guard)', async () => {
      const dto = plainToInstance(CreateShipmentDto, {
        carrier: 'manual',
        meta: 'string-not-object' as any,
      });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /meta/i.test(m))).toBe(true);
    });

    it('accepts a typical shipment payload', async () => {
      const dto = plainToInstance(CreateShipmentDto, {
        carrier: 'yurtici',
        trackingNo: '12345',
        meta: { labelUrl: 'https://...' },
      });
      expect(await errors(dto)).toEqual([]);
    });
  });
});
