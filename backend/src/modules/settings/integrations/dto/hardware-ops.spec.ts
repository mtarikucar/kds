import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ReportDeviceEventDto,
  ToggleIntegrationStatusDto,
  UpdateDeviceStatusDto,
} from './hardware-ops.dto';

/**
 * Iter-66 regression. Three controller endpoints used inline @Body()
 * shapes — ValidationPipe doesn't fire on inline TS types. The
 * load-bearing case is UpdateDeviceStatusDto on
 * /api/hardware/devices/:id/status, which WAITER + KITCHEN roles
 * can hit and the service merges straight into config.device_status.
 * Without a DTO they could store strings / primitives / null in the
 * JSONB column, or smuggle multi-MB blobs that every staff device
 * then fetches on getHardwareConfig.
 */
describe('Hardware-ops DTOs (iter-66)', () => {
  async function errors(dto: object): Promise<string[]> {
    const results = await validate(dto);
    return results.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  describe('ToggleIntegrationStatusDto', () => {
    it('accepts a boolean', async () => {
      const dto = plainToInstance(ToggleIntegrationStatusDto, { isEnabled: true });
      expect(await errors(dto)).toEqual([]);
    });

    it('rejects a string "true" (the load-bearing coercion guard)', async () => {
      const dto = plainToInstance(ToggleIntegrationStatusDto, { isEnabled: 'true' });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /isEnabled/i.test(m))).toBe(true);
    });

    it('rejects a missing field', async () => {
      const dto = plainToInstance(ToggleIntegrationStatusDto, {});
      const msgs = await errors(dto);
      expect(msgs.some((m) => /isEnabled/i.test(m))).toBe(true);
    });
  });

  describe('UpdateDeviceStatusDto', () => {
    it('accepts an object', async () => {
      const dto = plainToInstance(UpdateDeviceStatusDto, {
        status: { paperLow: true, temperature: 42 },
      });
      expect(await errors(dto)).toEqual([]);
    });

    it('rejects a string (the load-bearing JSONB shape guard)', async () => {
      const dto = plainToInstance(UpdateDeviceStatusDto, { status: 'paper-low' as any });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /status/i.test(m))).toBe(true);
    });

    it('rejects null', async () => {
      const dto = plainToInstance(UpdateDeviceStatusDto, { status: null as any });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /status/i.test(m))).toBe(true);
    });
  });

  describe('ReportDeviceEventDto', () => {
    it('accepts event-only payload', async () => {
      const dto = plainToInstance(ReportDeviceEventDto, { event: 'printer.connected' });
      expect(await errors(dto)).toEqual([]);
    });

    it('rejects oversize event name', async () => {
      const dto = plainToInstance(ReportDeviceEventDto, { event: 'e'.repeat(121) });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /event/i.test(m))).toBe(true);
    });

    it('rejects a non-object data field', async () => {
      const dto = plainToInstance(ReportDeviceEventDto, {
        event: 'printer.error',
        data: 'string-not-object' as any,
      });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /data/i.test(m))).toBe(true);
    });
  });
});
