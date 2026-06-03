import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  BridgeHeartbeatDto,
  ClaimBridgeDto,
  CreateBridgeSlotDto,
} from './local-bridge.dto';

/**
 * Iter-63 regression. Three local-bridge controller endpoints used
 * inline TypeScript types for @Body() — ValidationPipe doesn't fire on
 * those. The load-bearing case is /v1/bridges/claim which is @Public
 * and feeds the raw provisioningToken into sha256; an unbounded input
 * was a CPU-amplification surface. iter-63 caps it at 128 chars (the
 * natural token is `${uuidv7}.${base64url(32 bytes)}` ≈ 80 chars).
 *
 * createSlot's branchId was a bare string — non-UUIDs slipped through
 * and Prisma silently no-matched, producing "Branch not found".
 */
describe('Local-bridge body DTOs (iter-63)', () => {
  async function errors(dto: object): Promise<string[]> {
    const results = await validate(dto);
    return results.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  describe('CreateBridgeSlotDto', () => {
    it('accepts a typical payload', async () => {
      const dto = plainToInstance(CreateBridgeSlotDto, {
        branchId: '550e8400-e29b-41d4-a716-446655440000',
      });
      expect(await errors(dto)).toEqual([]);
    });

    it('rejects non-UUID branchId', async () => {
      const dto = plainToInstance(CreateBridgeSlotDto, { branchId: 'not-a-uuid' });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /branchId/i.test(m))).toBe(true);
    });

    it('rejects oversize productSku / hostname', async () => {
      const dto = plainToInstance(CreateBridgeSlotDto, {
        branchId: '550e8400-e29b-41d4-a716-446655440000',
        productSku: 'x'.repeat(201),
      });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /productSku/i.test(m))).toBe(true);
    });
  });

  describe('ClaimBridgeDto', () => {
    it('requires provisioningToken', async () => {
      const dto = plainToInstance(ClaimBridgeDto, {});
      const msgs = await errors(dto);
      expect(msgs.some((m) => /provisioningToken/i.test(m))).toBe(true);
    });

    it('rejects a comically short token (likely typo)', async () => {
      const dto = plainToInstance(ClaimBridgeDto, { provisioningToken: 'short' });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /provisioningToken/i.test(m))).toBe(true);
    });

    it('rejects a 100KB token — the load-bearing sha256 CPU-DoS guard', async () => {
      const dto = plainToInstance(ClaimBridgeDto, {
        provisioningToken: 'x'.repeat(100_000),
      });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /provisioningToken/i.test(m))).toBe(true);
    });

    it('rejects a 129-char token (just over the 128 cap)', async () => {
      const dto = plainToInstance(ClaimBridgeDto, {
        provisioningToken: 'x'.repeat(129),
      });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /provisioningToken/i.test(m))).toBe(true);
    });

    it('accepts a realistic 80-char uuidv7+base64url token', async () => {
      const dto = plainToInstance(ClaimBridgeDto, {
        provisioningToken: '0190a1b2-c3d4-7567-89ab-cdef01234567.YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU',
      });
      expect(await errors(dto)).toEqual([]);
    });
  });

  describe('BridgeHeartbeatDto', () => {
    it('accepts an empty heartbeat', async () => {
      const dto = plainToInstance(BridgeHeartbeatDto, {});
      expect(await errors(dto)).toEqual([]);
    });

    it('rejects oversize hostname', async () => {
      const dto = plainToInstance(BridgeHeartbeatDto, { hostname: 'h'.repeat(201) });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /hostname/i.test(m))).toBe(true);
    });
  });
});
