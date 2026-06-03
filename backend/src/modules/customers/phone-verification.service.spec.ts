import { BadRequestException } from '@nestjs/common';
import { PhoneVerificationService } from './phone-verification.service';
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
