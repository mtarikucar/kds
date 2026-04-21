import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  SuperAdminLoginDto,
  SuperAdminLoginResponseDto,
} from '../dto/login.dto';
import {
  Verify2FADto,
  Setup2FAResponseDto,
  Enable2FADto,
} from '../dto/verify-2fa.dto';
import { SuperAdminAuditService } from './superadmin-audit.service';
import { AuditAction, EntityType } from '../dto/audit-filter.dto';

/**
 * TOTP time window. 1 = accept the current 30s step plus one on each
 * side (so ~90s of drift tolerance), which matches Google's recommended
 * hardening and is the default for speakeasy. The prior `window: 4`
 * (≈4.5 minutes) made sniffed codes usable for far too long.
 */
const TOTP_WINDOW = 1;

/** Once a TOTP step is accepted we refuse to accept it again for this
 * many milliseconds, killing naive replay of a sniffed code. Should
 * cover the generous edge of `TOTP_WINDOW`. */
const TOTP_REPLAY_LOCK_MS = 90_000;

const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_BYTES = 5; // 10 hex chars per code

// Dummy bcrypt hash used to normalize response time on the "email not
// found" path. Without this an attacker can tell a valid SA email from
// a bogus one by measuring whether bcrypt.compare ran. Computed once at
// module load with the default cost.
const DUMMY_SA_BCRYPT_HASH = bcrypt.hashSync(
  'dummy-password-for-timing-normalization',
  12,
);

@Injectable()
export class SuperAdminAuthService {
  private readonly logger = new Logger(SuperAdminAuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private auditService: SuperAdminAuditService,
  ) {}

  private hashSecret(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private bcryptCost(): number {
    const raw = this.configService.get<string>('BCRYPT_COST');
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed >= 10 && parsed <= 15 ? parsed : 12;
  }

  /**
   * Verify a TOTP code against the stored secret, refusing replay of a
   * code whose step has already been accepted within the replay window.
   * Returns the accepted step on success so the caller can persist it.
   */
  private async verifyTotp(
    superAdmin: {
      id: string;
      twoFactorSecret: string | null;
      lastTotpStep: bigint | null;
      lastTotpStepExpiresAt: Date | null;
    },
    token: string,
    secret?: string,
  ): Promise<boolean> {
    const effectiveSecret = secret ?? superAdmin.twoFactorSecret;
    if (!effectiveSecret) return false;

    const delta = speakeasy.totp.verifyDelta({
      secret: effectiveSecret,
      encoding: 'base32',
      token,
      window: TOTP_WINDOW,
    });
    if (!delta) return false;

    // TOTP steps are 30s and anchored at unix epoch.
    const step = BigInt(Math.floor(Date.now() / 30_000) + delta.delta);

    // Reject replay of a step we've already accepted within the lock.
    if (
      superAdmin.lastTotpStep != null &&
      superAdmin.lastTotpStepExpiresAt &&
      superAdmin.lastTotpStepExpiresAt > new Date() &&
      superAdmin.lastTotpStep === step
    ) {
      return false;
    }

    await this.prisma.superAdmin.update({
      where: { id: superAdmin.id },
      data: {
        lastTotpStep: step,
        lastTotpStepExpiresAt: new Date(Date.now() + TOTP_REPLAY_LOCK_MS),
      },
    });
    return true;
  }

  private async verifyBackupCode(
    superAdmin: { id: string; backupCodes: string[] },
    code: string,
  ): Promise<boolean> {
    const normalized = code.replace(/\s+/g, '').toLowerCase();
    if (!normalized) return false;
    const hash = this.hashSecret(normalized);
    if (!superAdmin.backupCodes.includes(hash)) return false;
    // Burn the used code.
    await this.prisma.superAdmin.update({
      where: { id: superAdmin.id },
      data: {
        backupCodes: superAdmin.backupCodes.filter((c) => c !== hash),
      },
    });
    return true;
  }

  private generateBackupCodes(): {
    plaintext: string[];
    hashed: string[];
  } {
    const plaintext: string[] = [];
    const hashed: string[] = [];
    for (let i = 0; i < BACKUP_CODE_COUNT; i += 1) {
      const code = randomBytes(BACKUP_CODE_BYTES).toString('hex');
      plaintext.push(code);
      hashed.push(this.hashSecret(code));
    }
    return { plaintext, hashed };
  }

  async login(
    loginDto: SuperAdminLoginDto,
    ip?: string,
    userAgent?: string,
  ): Promise<SuperAdminLoginResponseDto> {
    const { email, password } = loginDto;

    const superAdmin = await this.prisma.superAdmin.findUnique({
      where: { email },
    });

    if (!superAdmin) {
      // Run bcrypt against a throwaway hash so the response time does
      // NOT leak whether the email exists. SA has a tiny population and
      // leaked timing here is a meaningful enumeration primitive.
      await bcrypt.compare(password, DUMMY_SA_BCRYPT_HASH).catch(() => false);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (superAdmin.lockedUntil && superAdmin.lockedUntil > new Date()) {
      const remainingMinutes = Math.ceil(
        (superAdmin.lockedUntil.getTime() - Date.now()) / 60000,
      );
      throw new UnauthorizedException(
        `Account locked. Try again in ${remainingMinutes} minutes.`,
      );
    }

    if (superAdmin.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is inactive');
    }

    const isPasswordValid = await bcrypt.compare(password, superAdmin.password);
    if (!isPasswordValid) {
      const failedLogins = superAdmin.failedLogins + 1;
      const updateData: { failedLogins: number; lockedUntil?: Date } = { failedLogins };
      if (failedLogins >= 5) {
        const lockUntil = new Date();
        lockUntil.setMinutes(lockUntil.getMinutes() + 30);
        updateData.lockedUntil = lockUntil;
      }
      await this.prisma.superAdmin.update({
        where: { id: superAdmin.id },
        data: updateData,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    // 2FA is MANDATORY for superadmins. If an account doesn't yet have
    // 2FA enabled, refuse the login and direct ops to provision it
    // out-of-band (seed script or an authenticated superadmin's
    // user-management flow). This kills the old "password -> self-enroll
    // -> full access" bootstrap.
    if (!superAdmin.twoFactorEnabled) {
      await this.auditService.log({
        action: AuditAction.LOGIN,
        entityType: EntityType.SUPER_ADMIN,
        entityId: superAdmin.id,
        actorId: superAdmin.id,
        actorEmail: superAdmin.email,
        metadata: { ip, userAgent, reason: '2fa_not_enabled' },
      });
      throw new ForbiddenException(
        'Two-factor authentication is required. Contact platform ops to provision 2FA for this account.',
      );
    }

    await this.prisma.superAdmin.update({
      where: { id: superAdmin.id },
      data: { failedLogins: 0, lockedUntil: null },
    });

    const tempToken = this.jwtService.sign(
      {
        sub: superAdmin.id,
        email: superAdmin.email,
        type: 'superadmin-2fa-pending',
      },
      {
        secret: this.configService.get<string>('SUPERADMIN_JWT_SECRET'),
        expiresIn: '10m',
      },
    );

    return { requiresTwoFactor: true, tempToken };
  }

  async verify2FA(
    verify2FADto: Verify2FADto,
    ip?: string,
    userAgent?: string,
  ): Promise<SuperAdminLoginResponseDto> {
    const { tempToken, code } = verify2FADto;

    let payload: any;
    try {
      payload = this.jwtService.verify(tempToken, {
        secret: this.configService.get<string>('SUPERADMIN_JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (payload.type !== 'superadmin-2fa-pending') {
      throw new UnauthorizedException('Invalid token');
    }

    const superAdmin = await this.prisma.superAdmin.findUnique({
      where: { id: payload.sub },
    });
    if (!superAdmin || !superAdmin.twoFactorEnabled || !superAdmin.twoFactorSecret) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Accept either a TOTP code or one of the stored backup codes.
    const isTotp = await this.verifyTotp(
      {
        id: superAdmin.id,
        twoFactorSecret: superAdmin.twoFactorSecret,
        lastTotpStep: superAdmin.lastTotpStep,
        lastTotpStepExpiresAt: superAdmin.lastTotpStepExpiresAt,
      },
      code,
    );
    const isBackup = isTotp
      ? false
      : await this.verifyBackupCode(
          { id: superAdmin.id, backupCodes: superAdmin.backupCodes },
          code,
        );
    if (!isTotp && !isBackup) {
      throw new UnauthorizedException('Invalid 2FA code');
    }

    await this.prisma.superAdmin.update({
      where: { id: superAdmin.id },
      data: { lastLogin: new Date(), lastLoginIp: ip },
    });

    await this.auditService.log({
      action: AuditAction.LOGIN,
      entityType: EntityType.SUPER_ADMIN,
      entityId: superAdmin.id,
      actorId: superAdmin.id,
      actorEmail: superAdmin.email,
      metadata: { ip, userAgent, backupCodeUsed: isBackup },
    });

    return this.generateTokens({
      ...superAdmin,
      tokenVersion: superAdmin.tokenVersion,
    });
  }

  /**
   * Self-service 2FA setup for an already-authenticated superadmin.
   * Stores the new secret as `pendingTwoFactorSecret` so the live secret
   * is only replaced after the first valid TOTP confirms it.
   */
  async setup2FA(superAdminId: string): Promise<Setup2FAResponseDto> {
    const superAdmin = await this.prisma.superAdmin.findUnique({
      where: { id: superAdminId },
    });
    if (!superAdmin) {
      throw new UnauthorizedException('SuperAdmin not found');
    }

    const secret = speakeasy.generateSecret({
      name: `KDS SuperAdmin (${superAdmin.email})`,
      issuer: 'KDS',
      length: 32,
    });

    await this.prisma.superAdmin.update({
      where: { id: superAdmin.id },
      data: { pendingTwoFactorSecret: secret.base32 },
    });

    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url!);

    return {
      secret: secret.base32,
      qrCodeUrl,
      otpauthUrl: secret.otpauth_url!,
    };
  }

  /**
   * Confirm the pending 2FA secret (promoting it to the live secret),
   * generate fresh backup codes, and bump tokenVersion so any sessions
   * that existed before this change are invalidated. Returns the raw
   * backup codes exactly once — the caller must save them.
   */
  async enable2FA(
    superAdminId: string,
    enable2FADto: Enable2FADto,
  ): Promise<{ message: string; backupCodes: string[] }> {
    const superAdmin = await this.prisma.superAdmin.findUnique({
      where: { id: superAdminId },
    });
    if (!superAdmin || !superAdmin.pendingTwoFactorSecret) {
      throw new BadRequestException('Please set up 2FA first');
    }

    const isValid = await this.verifyTotp(
      {
        id: superAdmin.id,
        twoFactorSecret: superAdmin.pendingTwoFactorSecret,
        lastTotpStep: superAdmin.lastTotpStep,
        lastTotpStepExpiresAt: superAdmin.lastTotpStepExpiresAt,
      },
      enable2FADto.code,
      superAdmin.pendingTwoFactorSecret,
    );
    if (!isValid) {
      throw new BadRequestException('Invalid verification code');
    }

    const { plaintext, hashed } = this.generateBackupCodes();

    await this.prisma.superAdmin.update({
      where: { id: superAdminId },
      data: {
        twoFactorSecret: superAdmin.pendingTwoFactorSecret,
        pendingTwoFactorSecret: null,
        twoFactorEnabled: true,
        backupCodes: hashed,
        tokenVersion: { increment: 1 },
      },
    });

    await this.auditService.log({
      action: AuditAction.UPDATE,
      entityType: EntityType.SUPER_ADMIN,
      entityId: superAdminId,
      actorId: superAdminId,
      actorEmail: superAdmin.email,
      newData: { twoFactorEnabled: true },
    });

    return { message: '2FA enabled successfully', backupCodes: plaintext };
  }

  /**
   * Disable 2FA for the authenticated superadmin. Requires the current
   * password + a current TOTP (or backup code) to reduce the damage if
   * the session token is stolen.
   */
  async disable2FA(
    superAdminId: string,
    currentPassword: string,
    code: string,
  ): Promise<{ message: string }> {
    const superAdmin = await this.prisma.superAdmin.findUnique({
      where: { id: superAdminId },
    });
    if (!superAdmin) {
      throw new UnauthorizedException('SuperAdmin not found');
    }
    if (!superAdmin.twoFactorEnabled) {
      throw new BadRequestException('2FA is not enabled');
    }
    const passOk = await bcrypt.compare(currentPassword, superAdmin.password);
    if (!passOk) {
      throw new BadRequestException('Current password is incorrect');
    }
    const isTotp = await this.verifyTotp(
      {
        id: superAdmin.id,
        twoFactorSecret: superAdmin.twoFactorSecret,
        lastTotpStep: superAdmin.lastTotpStep,
        lastTotpStepExpiresAt: superAdmin.lastTotpStepExpiresAt,
      },
      code,
    );
    const isBackup = isTotp
      ? false
      : await this.verifyBackupCode(
          { id: superAdmin.id, backupCodes: superAdmin.backupCodes },
          code,
        );
    if (!isTotp && !isBackup) {
      throw new BadRequestException('Invalid verification code');
    }

    await this.prisma.superAdmin.update({
      where: { id: superAdminId },
      data: {
        twoFactorSecret: null,
        pendingTwoFactorSecret: null,
        twoFactorEnabled: false,
        backupCodes: [],
        tokenVersion: { increment: 1 },
      },
    });

    await this.auditService.log({
      action: AuditAction.UPDATE,
      entityType: EntityType.SUPER_ADMIN,
      entityId: superAdminId,
      actorId: superAdminId,
      actorEmail: superAdmin.email,
      newData: { twoFactorEnabled: false },
    });

    return { message: '2FA disabled successfully' };
  }

  async regenerateBackupCodes(
    superAdminId: string,
    code: string,
  ): Promise<{ backupCodes: string[] }> {
    const superAdmin = await this.prisma.superAdmin.findUnique({
      where: { id: superAdminId },
    });
    if (!superAdmin || !superAdmin.twoFactorEnabled) {
      throw new BadRequestException('2FA is not enabled');
    }
    const isTotp = await this.verifyTotp(
      {
        id: superAdmin.id,
        twoFactorSecret: superAdmin.twoFactorSecret,
        lastTotpStep: superAdmin.lastTotpStep,
        lastTotpStepExpiresAt: superAdmin.lastTotpStepExpiresAt,
      },
      code,
    );
    if (!isTotp) {
      throw new BadRequestException('Invalid verification code');
    }
    const { plaintext, hashed } = this.generateBackupCodes();
    await this.prisma.superAdmin.update({
      where: { id: superAdminId },
      data: { backupCodes: hashed },
    });
    return { backupCodes: plaintext };
  }

  async logout(
    superAdminId: string,
    ip?: string,
    userAgent?: string,
  ): Promise<{ message: string }> {
    const superAdmin = await this.prisma.superAdmin.findUnique({
      where: { id: superAdminId },
      select: { email: true },
    });

    // Bump tokenVersion so any outstanding access/refresh tokens are
    // invalidated on the next guard check.
    await this.prisma.superAdmin.update({
      where: { id: superAdminId },
      data: { tokenVersion: { increment: 1 } },
    });

    if (superAdmin) {
      await this.auditService.log({
        action: AuditAction.LOGOUT,
        entityType: EntityType.SUPER_ADMIN,
        entityId: superAdminId,
        actorId: superAdminId,
        actorEmail: superAdmin.email,
        metadata: { ip, userAgent },
      });
    }

    return { message: 'Logged out successfully' };
  }

  async refreshToken(
    refreshToken: string,
  ): Promise<SuperAdminLoginResponseDto> {
    let payload: any;
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('SUPERADMIN_JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (payload.type !== 'superadmin-refresh') {
      throw new UnauthorizedException('Invalid token type');
    }

    const superAdmin = await this.prisma.superAdmin.findUnique({
      where: { id: payload.sub },
    });
    if (!superAdmin || superAdmin.status !== 'ACTIVE') {
      throw new UnauthorizedException('SuperAdmin not found or inactive');
    }
    if (typeof payload.ver === 'number' && payload.ver !== superAdmin.tokenVersion) {
      throw new UnauthorizedException('Session revoked');
    }

    return this.generateTokens(superAdmin);
  }

  private generateTokens(superAdmin: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    tokenVersion: number;
  }): SuperAdminLoginResponseDto {
    const basePayload = {
      sub: superAdmin.id,
      email: superAdmin.email,
      ver: superAdmin.tokenVersion,
    };
    const accessToken = this.jwtService.sign(
      { ...basePayload, type: 'superadmin' },
      {
        secret: this.configService.get<string>('SUPERADMIN_JWT_SECRET'),
        expiresIn: '1h',
        algorithm: 'HS256',
      },
    );
    const refreshToken = this.jwtService.sign(
      { ...basePayload, type: 'superadmin-refresh' },
      {
        secret: this.configService.get<string>('SUPERADMIN_JWT_REFRESH_SECRET'),
        expiresIn: '7d',
        algorithm: 'HS256',
      },
    );
    return {
      requiresTwoFactor: false,
      accessToken,
      refreshToken,
      superAdmin: {
        id: superAdmin.id,
        email: superAdmin.email,
        firstName: superAdmin.firstName,
        lastName: superAdmin.lastName,
      },
    };
  }

  /**
   * Bootstrap helper intended to be invoked from a one-shot CLI / seed
   * script, NOT from an HTTP handler. It refuses to run if any superadmin
   * already exists. Generates a TOTP secret + backup codes alongside the
   * account so first login can go straight through verify-2fa without
   * going through any self-serve enrollment endpoint.
   */
  async createInitialSuperAdmin(
    email: string,
    password: string,
    firstName: string,
    lastName: string,
  ): Promise<{
    id: string;
    email: string;
    otpauthUrl: string;
    backupCodes: string[];
  }> {
    const existingCount = await this.prisma.superAdmin.count();
    if (existingCount > 0) {
      throw new BadRequestException('SuperAdmin already exists');
    }

    const hashedPassword = await bcrypt.hash(password, this.bcryptCost());
    const secret = speakeasy.generateSecret({
      name: `KDS SuperAdmin (${email})`,
      issuer: 'KDS',
      length: 32,
    });
    const { plaintext, hashed } = this.generateBackupCodes();

    const superAdmin = await this.prisma.superAdmin.create({
      data: {
        email,
        password: hashedPassword,
        firstName,
        lastName,
        status: 'ACTIVE',
        twoFactorEnabled: true,
        twoFactorSecret: secret.base32,
        backupCodes: hashed,
      },
      select: { id: true, email: true },
    });

    return {
      id: superAdmin.id,
      email: superAdmin.email,
      otpauthUrl: secret.otpauth_url!,
      backupCodes: plaintext,
    };
  }
}
