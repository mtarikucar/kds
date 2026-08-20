import { BadRequestException } from '@nestjs/common';
import { PhoneVerificationService } from './phone-verification.service';
import { E164_MESSAGE } from '../../common/phone/e164.const';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

/**
 * Iter-31 regression: getVerificationStatus IDOR + phone PII masking.
 *
 * The earlier service-level findFirst scoped only by (id, tenantId), so
 * any active customer session in the same tenant could look up another
 * session's verificationId — leaking the phone in the response payload.
 * Pin the compound WHERE shape (id + sessionId + tenantId) and the
 * masked phone in the output.
 */
describe('PhoneVerificationService.getVerificationStatus (iter-31)', () => {
  let prisma: MockPrismaClient;
  let svc: PhoneVerificationService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    const sms: any = { sendVerificationCode: jest.fn(), isServiceEnabled: () => true };
    svc = new PhoneVerificationService(prisma as any, sms);
  });

  it('scopes findFirst by sessionId in addition to tenantId', async () => {
    (prisma.phoneVerification.findFirst as any).mockResolvedValue({
      id: 'v-1',
      phone: '+905551234567',
      verified: false,
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
      maxAttempts: 3,
      createdAt: new Date(),
      verifiedAt: null,
    });

    await svc.getVerificationStatus('v-1', 'sess-1', 'tenant-1');

    const where = (prisma.phoneVerification.findFirst as any).mock.calls[0][0].where;
    // The load-bearing assertion — without sessionId in the WHERE, any
    // session in the tenant could look up any verification.
    expect(where).toEqual({ id: 'v-1', sessionId: 'sess-1', tenantId: 'tenant-1' });
  });

  it('throws BadRequest when the verification does not belong to the session (foreign-session lookup)', async () => {
    // Mock returns null: the compound WHERE filtered it out because the
    // sessionId doesn't match.
    (prisma.phoneVerification.findFirst as any).mockResolvedValue(null);

    await expect(
      svc.getVerificationStatus('v-foreign', 'sess-mine', 'tenant-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('masks the phone in the response so the polling caller cannot read PII', async () => {
    (prisma.phoneVerification.findFirst as any).mockResolvedValue({
      id: 'v-1',
      phone: '+905551234567',
      verified: false,
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
      maxAttempts: 3,
      createdAt: new Date(),
      verifiedAt: null,
    });

    const out: any = await svc.getVerificationStatus('v-1', 'sess-1', 'tenant-1');

    expect(out.phone).not.toBe('+905551234567');
    // Mask should retain enough to confirm the user is polling the right
    // record (last few digits) but not enough to dox a captured id.
    expect(out.phone).toMatch(/[*]/);
  });
});

/**
 * T5 sweep: sendOTP's format gate used the loose `/^\+?[1-9]\d{7,14}$/`
 * regex directly (this service does not go through @NormalizePhone — its
 * own customers.helpers.ts normalizePhone() runs first, which already
 * turns a Turkish national/no-plus shape into "+90…"). In practice the
 * only callers are SendOTPDto/VerifyOTPDto, both of which already enforce
 * the shared E164_PATTERN upstream — so this check is a second, now
 * strict, gate on an already-validated value.
 */
describe('PhoneVerificationService.sendOTP phone format gate (T5)', () => {
  it('rejects a bare-digit phone without "+" (loose-to-strict tightening)', async () => {
    const prisma = mockPrismaClient();
    const sms: any = { sendVerificationCode: jest.fn(), isServiceEnabled: () => true };
    const svc = new PhoneVerificationService(prisma as any, sms);

    // "12345678" is not a parseable phone under any region, so the local
    // normalizePhone() helper returns it unchanged (no '+') — the old loose
    // regex accepted that shape; the shared E164_PATTERN rejects it.
    await expect(svc.sendOTP('12345678', 'sess-1', 'tenant-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  // Fix round 1: this is a generic, no-field-name-needed context (a raw
  // phone string param, not a multi-field DTO), so E164_MESSAGE — the
  // shared constant otherwise exported with zero call sites — is the
  // genuinely right message here rather than a bespoke duplicate.
  it('throws the shared E164_MESSAGE (not a bespoke duplicate string)', async () => {
    const prisma = mockPrismaClient();
    const sms: any = { sendVerificationCode: jest.fn(), isServiceEnabled: () => true };
    const svc = new PhoneVerificationService(prisma as any, sms);

    await expect(svc.sendOTP('12345678', 'sess-1', 'tenant-1')).rejects.toThrow(
      E164_MESSAGE,
    );
  });

  it('accepts a canonical E.164 phone (format gate does not block real numbers)', async () => {
    const prisma = mockPrismaClient();
    (prisma.phoneVerification.findFirst as any).mockResolvedValue(null);
    (prisma.phoneVerification.count as any).mockResolvedValue(0);
    (prisma.phoneVerification.create as any).mockResolvedValue({ id: 'v-1' });
    const sms: any = {
      sendVerificationCode: jest.fn().mockResolvedValue(true),
      isServiceEnabled: () => true,
    };
    const svc = new PhoneVerificationService(prisma as any, sms);

    await expect(
      svc.sendOTP('+905551234567', 'sess-1', 'tenant-1'),
    ).resolves.toBeDefined();
  });
});
