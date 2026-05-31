import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SmsService } from './sms.service';
import {
  constantTimeEquals,
  generateOtp,
  hashOtp,
  normalizePhone,
} from './customers.helpers';
import { maskPhone } from '../../common/helpers/pii-mask.helper';

// Per-tenant and per-phone daily send caps to bound SMS cost and blunt
// pumping-fraud (attacker cycles target phones to evade the 60s per-phone
// cooldown). Numbers chosen conservative; raise via config if legitimate
// usage patterns show throttling.
const DAILY_TENANT_SEND_CAP = 500;
// v2.8.94 — lowered from 8 → 5. Per-OTP maxAttempts=3 + 5 sends = 15
// brute-force attempts per phone per day; on a 6-digit code (10^6 space)
// it's still vanishingly small but tightens the budget by ~37%.
const DAILY_PHONE_SEND_CAP = 5;
const DAILY_SESSION_SEND_CAP = 10;

// v2.8.94 — cumulative verification-failure cap. Counts rows where
// attempts >= maxAttempts (the OTP "burned" without success) plus rows
// with verified=true=false but already past the most recent maxAttempts
// budget. Past 24h. If the phone burned through this many codes via
// wrong guesses, it's almost certainly an attacker. Locks both sendOTP
// (no new codes) and verifyOTP (no more guesses).
const DAILY_PHONE_FAILURE_LOCKOUT = 15;
const FAILURE_LOCKOUT_WINDOW_MS = 24 * 60 * 60_000;

@Injectable()
export class PhoneVerificationService {
  private readonly logger = new Logger(PhoneVerificationService.name);

  constructor(
    private prisma: PrismaService,
    private smsService: SmsService,
  ) {}

  async sendOTP(
    phoneRaw: string,
    sessionId: string,
    tenantId: string,
  ): Promise<{ verificationId: string; expiresAt: Date; message: string }> {
    const phone = normalizePhone(phoneRaw);
    if (!/^\+?[1-9]\d{7,14}$/.test(phone)) {
      throw new BadRequestException('Invalid phone number format');
    }

    const now = new Date();
    const oneMinAgo = new Date(now.getTime() - 60_000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60_000);

    // Per-phone 60s cooldown
    const recentAttempt = await this.prisma.phoneVerification.findFirst({
      where: { phone, tenantId, createdAt: { gte: oneMinAgo } },
      orderBy: { createdAt: 'desc' },
    });
    if (recentAttempt) {
      throw new BadRequestException('Please wait 60 seconds before requesting another code');
    }

    // Daily caps
    const [phoneCount, tenantCount, sessionCount] = await Promise.all([
      this.prisma.phoneVerification.count({
        where: { phone, tenantId, createdAt: { gte: oneDayAgo } },
      }),
      this.prisma.phoneVerification.count({
        where: { tenantId, createdAt: { gte: oneDayAgo } },
      }),
      sessionId
        ? this.prisma.phoneVerification.count({
            where: { sessionId, createdAt: { gte: oneDayAgo } },
          })
        : Promise.resolve(0),
    ]);

    if (phoneCount >= DAILY_PHONE_SEND_CAP) {
      throw new BadRequestException('Daily verification limit reached for this phone');
    }
    if (tenantCount >= DAILY_TENANT_SEND_CAP) {
      throw new BadRequestException('Daily verification limit reached — please try again tomorrow');
    }
    if (sessionId && sessionCount >= DAILY_SESSION_SEND_CAP) {
      throw new BadRequestException('Too many verification attempts on this session');
    }

    // v2.8.94 — cumulative failure lockout. A phone that has burned
    // through DAILY_PHONE_FAILURE_LOCKOUT codes via wrong guesses in
    // the past 24h is locked from getting more codes. Without this an
    // attacker could exhaust each code's 3-attempt budget and
    // immediately request the next code (limited by the per-phone
    // 60s cooldown but otherwise unbounded under the daily cap).
    await this.assertNotInFailureLockout(phone, tenantId);

    const code = generateOtp();
    const storedCode = hashOtp(code);
    const expiresAt = new Date(now.getTime() + 10 * 60_000);

    const verification = await this.prisma.phoneVerification.create({
      data: {
        phone,
        code: storedCode,
        expiresAt,
        sessionId,
        tenantId,
        attempts: 0,
        maxAttempts: 3,
      },
    });

    const smsSent = await this.smsService.sendVerificationCode(phone, code);
    if (!smsSent && this.smsService.isServiceEnabled()) {
      this.logger.warn(`SMS delivery failed for ${maskPhone(phone)}`);
    }
    if (!this.smsService.isServiceEnabled()) {
      // Dev-only OTP echo. Phone masked but code stays visible because
      // the whole point of this branch is local-dev OTP testing without
      // a real SMS provider — masking the code would defeat the use case.
      // This branch is unreachable in prod (iter-28 makes SMS_PROVIDER
      // config required, indirectly via the provider's own creds check
      // — and isServiceEnabled() returns true when a provider is wired).
      this.logger.debug(`OTP for ${maskPhone(phone)}: ${code} (dev only)`);
    }

    return {
      verificationId: verification.id,
      expiresAt: verification.expiresAt,
      message: 'Verification code sent to your phone',
    };
  }

  /**
   * Verify code. The increment + code compare are done in a single
   * conditional updateMany so two parallel wrong guesses cannot both
   * under-count `attempts`. Binding to sessionId is required — a knowledge
   * of (phone, tenant) without the session that initiated the send cannot
   * consume a legit user's code.
   */
  async verifyOTP(
    phoneRaw: string,
    code: string,
    sessionId: string,
    tenantId: string,
  ): Promise<{ verified: boolean; verificationId: string }> {
    const phone = normalizePhone(phoneRaw);
    const verification = await this.prisma.phoneVerification.findFirst({
      where: {
        phone,
        tenantId,
        sessionId,
        verified: false,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!verification) {
      throw new BadRequestException('No active verification found or code expired');
    }

    // v2.8.94 — mirror the sendOTP-side lockout on the verify path so an
    // attacker who already has a code in hand can't keep firing guesses
    // after the (phone, tenant) crossed the failure threshold. The
    // sendOTP path normally catches this earlier, but a code in flight
    // when the threshold was crossed must also be refused.
    await this.assertNotInFailureLockout(phone, tenantId);

    // Atomic increment gated on attempts < max — if another request just
    // consumed the last attempt, count will be 0 and we treat as locked out.
    const incResult = await this.prisma.phoneVerification.updateMany({
      where: {
        id: verification.id,
        attempts: { lt: verification.maxAttempts },
        verified: false,
      },
      data: { attempts: { increment: 1 } },
    });
    if (incResult.count === 0) {
      throw new BadRequestException(
        'Maximum verification attempts reached. Please request a new code.',
      );
    }

    const submitted = hashOtp(code);
    if (!constantTimeEquals(submitted, verification.code)) {
      const remaining = verification.maxAttempts - (verification.attempts + 1);
      throw new UnauthorizedException(
        `Invalid verification code. ${Math.max(0, remaining)} attempts remaining.`,
      );
    }

    const markVerified = await this.prisma.phoneVerification.updateMany({
      where: { id: verification.id, verified: false },
      data: { verified: true, verifiedAt: new Date() },
    });
    if (markVerified.count === 0) {
      // Already consumed by a concurrent verify — treat as success is fine
      // but surface the caller's intent by re-reading.
    }

    return { verified: true, verificationId: verification.id };
  }

  /**
   * v2.8.94 — cumulative failure lockout helper. Counts verification
   * rows in the past FAILURE_LOCKOUT_WINDOW_MS that ended with
   * attempts == maxAttempts and verified=false (i.e. all 3 guesses
   * burned without success) plus the current row's attempts. If the
   * total reaches DAILY_PHONE_FAILURE_LOCKOUT, refuse.
   */
  private async assertNotInFailureLockout(
    phone: string,
    tenantId: string,
  ): Promise<void> {
    const since = new Date(Date.now() - FAILURE_LOCKOUT_WINDOW_MS);
    const burnedCount = await this.prisma.phoneVerification.count({
      where: {
        phone,
        tenantId,
        verified: false,
        createdAt: { gte: since },
        // Postgres-side equality between two columns is awkward in
        // Prisma without raw SQL. Use the floor: any row with at least
        // one failed attempt counts. This is slightly more conservative
        // than "fully burned" (3 attempts), which is intentional — a
        // partially-burned code still represents an active attacker.
        attempts: { gt: 0 },
      },
    });
    if (burnedCount >= DAILY_PHONE_FAILURE_LOCKOUT) {
      this.logger.warn(
        `Phone failure lockout triggered for ${maskPhone(phone)} tenant=${tenantId} (${burnedCount} failures in ${FAILURE_LOCKOUT_WINDOW_MS / 3600_000}h)`,
      );
      throw new BadRequestException(
        'Too many failed verification attempts on this phone. Please try again in 24 hours.',
      );
    }
  }

  async isPhoneVerified(phoneRaw: string, tenantId: string): Promise<boolean> {
    const phone = normalizePhone(phoneRaw);
    const verification = await this.prisma.phoneVerification.findFirst({
      where: { phone, tenantId, verified: true },
      orderBy: { verifiedAt: 'desc' },
    });
    return !!verification;
  }

  /**
   * Look up a verification's status. SCOPE BY SESSION, not just by
   * tenant — without the session bind, any active customer session in
   * the same tenant could look up another customer's verificationId
   * (URL leak, log scrape, support-ticket screenshot) and learn the
   * phone number. The session is what's bound to the send in the first
   * place, so the same session is the only legitimate reader.
   *
   * Phone is masked in the response (e.g. "+90 5** *** **45") — the
   * caller already knows the phone they sent the OTP to; the response
   * is for status polling, not phone disclosure.
   */
  async getVerificationStatus(verificationId: string, sessionId: string, tenantId: string) {
    const verification = await this.prisma.phoneVerification.findFirst({
      where: { id: verificationId, sessionId, tenantId },
      select: {
        id: true,
        phone: true,
        verified: true,
        expiresAt: true,
        attempts: true,
        maxAttempts: true,
        createdAt: true,
        verifiedAt: true,
      },
    });

    if (!verification) throw new BadRequestException('Verification not found');
    return {
      ...verification,
      phone: maskPhone(verification.phone),
      expired: verification.expiresAt < new Date(),
      attemptsRemaining: verification.maxAttempts - verification.attempts,
    };
  }

  async cleanupExpiredVerifications(): Promise<number> {
    const result = await this.prisma.phoneVerification.deleteMany({
      where: {
        verified: false,
        expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60_000) },
      },
    });
    return result.count;
  }
}
