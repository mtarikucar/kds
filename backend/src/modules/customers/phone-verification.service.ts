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

// Per-tenant and per-phone daily send caps to bound SMS cost and blunt
// pumping-fraud (attacker cycles target phones to evade the 60s per-phone
// cooldown). Numbers chosen conservative; raise via config if legitimate
// usage patterns show throttling.
const DAILY_TENANT_SEND_CAP = 500;
const DAILY_PHONE_SEND_CAP = 8;
const DAILY_SESSION_SEND_CAP = 10;

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
      this.logger.warn(`SMS delivery failed for ${phone}`);
    }
    if (!this.smsService.isServiceEnabled()) {
      this.logger.debug(`OTP for ${phone}: ${code} (dev only)`);
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

  async isPhoneVerified(phoneRaw: string, tenantId: string): Promise<boolean> {
    const phone = normalizePhone(phoneRaw);
    const verification = await this.prisma.phoneVerification.findFirst({
      where: { phone, tenantId, verified: true },
      orderBy: { verifiedAt: 'desc' },
    });
    return !!verification;
  }

  async getVerificationStatus(verificationId: string, tenantId: string) {
    const verification = await this.prisma.phoneVerification.findFirst({
      where: { id: verificationId, tenantId },
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
