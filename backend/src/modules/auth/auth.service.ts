import {
  Injectable,
  Inject,
  forwardRef,
  Logger,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import * as appleSignin from 'apple-signin-auth';
import * as Sentry from '@sentry/node';
import { Prisma } from '@prisma/client';
import { addDays } from 'date-fns';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { GoogleAuthDto, AppleAuthDto } from './dto/social-auth.dto';
import { AuthResponseDto, UserResponseDto } from './dto/auth-response.dto';
import { ForgotPasswordDto, ResetPasswordDto, ChangePasswordDto } from './dto/password-reset.dto';
import { UserRole } from '../../common/constants/roles.enum';
import { PaymentProvider, TenantStatus } from '../../common/constants/subscription.enum';
import { EmailService } from '../../common/services/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/dto/create-notification.dto';
import {
  isSubdomainQuarantined,
  randomSubdomainSuffix,
} from '../../common/helpers/subdomain.helper';
import {
  ResourceAlreadyExistsException,
  ResourceNotFoundException,
  InvalidCredentialsException,
  ValidationException,
} from '../../common/exceptions';

// Dummy bcrypt hash used to normalize timing between "user not found" and
// "bad password" paths. bcrypt.compare against this hash takes the same
// work-factor cost as a real password check, so an attacker cannot use
// response-time deltas to enumerate which emails are registered.
// Computed once at module load with cost 12 (matches the default).
const DUMMY_BCRYPT_HASH = bcrypt.hashSync(
  'dummy-password-for-timing-normalization',
  12,
);

@Injectable()
export class AuthService {
  // Use NestJS Logger so messages flow through the structured-JSON pipeline
  // configured in main.ts. The previous `console.error` callsites bypassed
  // it, writing plain-text lines into the middle of the JSON log stream —
  // which breaks parsers (Loki/Datadog) that expect one valid JSON object
  // per line and skips any PII redaction the logger pipeline has.
  private readonly logger = new Logger(AuthService.name);
  private googleClient: OAuth2Client;

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * bcrypt work factor. 12 is the 2026 baseline; allow tenants to tune via
   * env so production can bump cost without a code change.
   */
  private bcryptCost(): number {
    const raw = this.configService.get<string>('BCRYPT_COST');
    const parsed = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed) && parsed >= 10 && parsed <= 15) {
      return parsed;
    }
    return 12;
  }

  /**
   * Find a free subdomain for a new tenant. Falls back to appending a
   * cryptographically-strong 6-hex suffix when the preferred slug is taken
   * or quarantined. Uniqueness is ultimately enforced by the DB unique
   * index (P2002 is caught by the caller); this just picks a candidate.
   */
  private async allocateSubdomain(base: string): Promise<string> {
    const baseClean = base || 'restaurant';
    const preferred = baseClean;
    const preferredTaken =
      (await isSubdomainQuarantined(this.prisma, preferred)) ||
      (await this.prisma.tenant.findUnique({ where: { subdomain: preferred } }));
    if (!preferredTaken) return preferred;
    // Up to 5 attempts with random suffix — extraordinarily unlikely to collide.
    for (let i = 0; i < 5; i += 1) {
      const candidate = `${baseClean}-${randomSubdomainSuffix()}`;
      const taken =
        (await isSubdomainQuarantined(this.prisma, candidate)) ||
        (await this.prisma.tenant.findUnique({ where: { subdomain: candidate } }));
      if (!taken) return candidate;
    }
    throw new Error('Could not allocate a free subdomain');
  }

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private emailService: EmailService,
    @Inject(forwardRef(() => NotificationsService))
    private notificationsService: NotificationsService,
  ) {
    // Initialize Google OAuth client
    this.googleClient = new OAuth2Client(
      this.configService.get<string>('GOOGLE_CLIENT_ID'),
    );
  }

  async register(registerDto: RegisterDto): Promise<AuthResponseDto> {
    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: registerDto.email },
    });

    if (existingUser) {
      throw new ResourceAlreadyExistsException('User', 'email', registerDto.email);
    }

    // Validate registration data
    const hasRestaurantName = !!registerDto.restaurantName;
    const hasTenantId = !!registerDto.tenantId;

    // Mutual exclusion: cannot provide both
    if (hasRestaurantName && hasTenantId) {
      throw new ValidationException('Cannot provide both restaurantName and tenantId');
    }

    // One of them must be provided
    if (!hasRestaurantName && !hasTenantId) {
      throw new ValidationException('Either restaurantName or tenantId must be provided');
    }

    let tenantId: string;
    let userRole = registerDto.role;

    // Scenario 1: Creating a new restaurant (ADMIN only)
    if (hasRestaurantName) {
      // If creating a restaurant, role must be ADMIN (or default to ADMIN)
      if (userRole && userRole !== UserRole.ADMIN) {
        throw new ValidationException('Only ADMIN role is allowed when creating a new restaurant');
      }
      userRole = UserRole.ADMIN;

      const baseSubdomain = registerDto.restaurantName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      const finalSubdomain = await this.allocateSubdomain(baseSubdomain);

      // Every new tenant gets a 14-day BUSINESS trial — the top-tier
      // plan with every premium feature open — at zero charge. Trial is
      // a one-time per-tenant benefit; the SchedulerService.expireTrials
      // job downgrades the tenant to FREE at trialEnd. We need the
      // BUSINESS plan here, not FREE, so the new tenant boots into a
      // fully-featured workspace from the first dashboard load.
      const businessPlan = await this.prisma.subscriptionPlan.findUnique({
        where: { name: 'BUSINESS' },
      });
      if (!businessPlan) {
        // Seed misconfigured — refuse to register rather than silently
        // landing the tenant on FREE without a trial. The user will get
        // a clear error and ops can re-seed.
        throw new ResourceNotFoundException('BUSINESS subscription plan');
      }
      if (businessPlan.trialDays <= 0) {
        throw new ResourceNotFoundException(
          'BUSINESS plan has no trialDays configured — re-seed plans',
        );
      }

      // Tenant + TRIALING BUSINESS subscription must be created
      // atomically so other modules never observe a tenant without a
      // matching subscription.
      const now = new Date();
      const trialEnd = addDays(now, businessPlan.trialDays);

      try {
        const tenant = await this.prisma.$transaction(async (tx) => {
          const created = await tx.tenant.create({
            data: {
              name: registerDto.restaurantName,
              subdomain: finalSubdomain,
              currentPlanId: businessPlan.id,
              // Per-tenant trial bookkeeping. `trialUsed=true` is the
              // canonical lifetime-trial gate read by
              // PaymentsService.createIntent + SubscriptionService;
              // once stamped, no further trials regardless of plan.
              // `usedTrialPlanIds` is kept for audit/reporting.
              trialUsed: true,
              trialStartedAt: now,
              trialEndsAt: trialEnd,
              usedTrialPlanIds: [businessPlan.id],
            },
          });
          await tx.subscription.create({
            data: {
              tenantId: created.id,
              planId: businessPlan.id,
              status: 'TRIALING',
              billingCycle: 'MONTHLY',
              // PayTR is the only configured provider; this row is the
              // trial — no charge moves until the post-trial checkout.
              paymentProvider: PaymentProvider.PAYTR,
              startDate: now,
              currentPeriodStart: now,
              // During trial, currentPeriodEnd == trialEnd. After
              // expireTrials downgrades to FREE, the FREE write path
              // resets these fields.
              currentPeriodEnd: trialEnd,
              isTrialPeriod: true,
              trialStart: now,
              trialEnd,
              amount: businessPlan.monthlyPrice,
              currency: businessPlan.currency,
              cancelAtPeriodEnd: false,
            },
          });
          return created;
        });
        tenantId = tenant.id;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          throw new ResourceAlreadyExistsException('Tenant', 'subdomain', finalSubdomain);
        }
        throw err;
      }
    }
    // Scenario 2: Joining an existing restaurant
    else {
      // Verify tenant exists
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: registerDto.tenantId },
      });

      if (!tenant) {
        throw new ResourceNotFoundException('Tenant', registerDto.tenantId);
      }

      // Cannot join as ADMIN (ADMIN creates their own restaurant)
      if (userRole === UserRole.ADMIN) {
        throw new ValidationException('Cannot join existing restaurant as ADMIN. ADMIN must create their own restaurant.');
      }

      // Default to WAITER if no role provided
      if (!userRole) {
        userRole = UserRole.WAITER;
      }

      tenantId = registerDto.tenantId;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(registerDto.password, this.bcryptCost());

    // Determine user status: ADMIN creating restaurant = ACTIVE, others = PENDING_APPROVAL
    const userStatus = hasRestaurantName ? 'ACTIVE' : 'PENDING_APPROVAL';

    // Create user
    const user = await this.prisma.user.create({
      data: {
        email: registerDto.email,
        password: hashedPassword,
        firstName: registerDto.firstName,
        lastName: registerDto.lastName,
        role: userRole,
        tenantId,
        status: userStatus,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        tenantId: true,
      },
    });

    // Send email verification code automatically after registration
    try {
      await this.sendEmailVerification(user.id);
    } catch (error) {
      // Log error but don't fail registration if email sending fails
      this.logger.error('Failed to send verification email', error as any);
    }

    // If user is pending approval, notify admins and return without tokens
    if (userStatus === 'PENDING_APPROVAL') {
      try {
        await this.notificationsService.notifyAdmins(tenantId, {
          title: 'Yeni Kullanıcı Onay Bekliyor',
          message: `${user.firstName} ${user.lastName} (${user.email}) hesap onayı bekliyor.`,
          type: NotificationType.WARNING,
          data: {
            action: 'USER_APPROVAL_REQUIRED',
            userId: user.id,
          },
        });
      } catch (error) {
        this.logger.error('Failed to notify admins about pending user', error as any);
      }

      // Return response without tokens - user needs approval
      return {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          tenantId: user.tenantId,
        },
        accessToken: null,
        refreshToken: null,
        pendingApproval: true,
        message: 'Kayıt başarılı. Hesabınız yönetici onayı bekliyor.',
      } as any;
    }

    // Track successful registration in Sentry. We deliberately exclude
    // email + firstName + lastName from both the message body and the
    // `extra` payload — sentry.config.ts's beforeSend only scrubs known
    // user.email/ip_address fields, NOT arbitrary message text or extras,
    // so anything we interpolate here would persist in Sentry's long-term
    // retention. GDPR/KVKK violation for a TR-resident SaaS. userId is
    // enough to join back to the app DB when debugging.
    Sentry.captureMessage('New user registered', {
      level: 'info',
      tags: {
        event: 'user.register',
        role: user.role,
        isNewRestaurant: String(hasRestaurantName),
      },
      extra: {
        userId: user.id,
        tenantId: user.tenantId,
      },
    });

    return this.generateTokens(user);
  }

  async login(loginDto: LoginDto, ip?: string, userAgent?: string): Promise<AuthResponseDto> {
    const user = await this.validateUser(loginDto.email, loginDto.password);

    if (!user) {
      // Track failed login attempt. Like in `register`, we keep the
      // submitted email out of Sentry — message body and extra fields
      // bypass beforeSend's user.email scrubber, so plaintext emails
      // would land in long-term retention.
      Sentry.captureMessage('Failed login attempt', {
        level: 'warning',
        tags: {
          event: 'user.login.failed',
        },
      });

      // Log failed login attempt if we can identify the user
      const existingUser = await this.prisma.user.findUnique({
        where: { email: loginDto.email },
        select: { id: true, tenantId: true },
      });
      if (existingUser) {
        await this.logUserActivity(existingUser.id, existingUser.tenantId, 'LOGIN_FAILED', ip, userAgent);
      }

      throw new InvalidCredentialsException();
    }

    // Track successful login in Sentry. Email excluded — see register/login
    // failed comments above.
    Sentry.captureMessage('User logged in', {
      level: 'info',
      tags: {
        event: 'user.login',
        role: user.role,
      },
      extra: {
        userId: user.id,
        tenantId: user.tenantId,
      },
    });

    // Log successful login activity
    await this.logUserActivity(user.id, user.tenantId, 'LOGIN', ip, userAgent);

    // Update last login timestamp
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    // Set user context for future errors. Email omitted — beforeSend would
    // strip event.user.email on outbound events anyway, but not passing it
    // in the first place means it's never sitting in the SDK's in-memory
    // scope where a misconfiguration could leak it.
    Sentry.setUser({
      id: user.id,
    });

    return this.generateTokens(user, ip, userAgent);
  }

  private async logUserActivity(
    userId: string,
    tenantId: string,
    action: string,
    ip?: string,
    userAgent?: string,
    metadata?: any,
  ): Promise<void> {
    try {
      await this.prisma.userActivity.create({
        data: {
          userId,
          tenantId,
          action,
          ip,
          userAgent,
          metadata,
        },
      });
    } catch (error) {
      this.logger.error('Failed to log user activity', error as any);
    }
  }

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        password: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        tenantId: true,
        tenant: { select: { status: true } },
      },
    });

    // Defer all account-state disclosure until after a successful password
    // check, so the endpoint cannot be used to enumerate registered emails.
    // When there is no matching user we STILL run bcrypt.compare against a
    // throwaway hash so the response time does not leak registration state
    // (timing-based email enumeration).
    if (!user) {
      await bcrypt.compare(password, DUMMY_BCRYPT_HASH).catch(() => false);
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return null;
    }

    if (user.status === 'PENDING_APPROVAL') {
      throw new UnauthorizedException('Hesabınız henüz onaylanmadı. Lütfen yönetici onayını bekleyin.');
    }
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User account is inactive');
    }
    if (user.tenant?.status !== TenantStatus.ACTIVE) {
      throw new UnauthorizedException('Your restaurant account is not active');
    }

    const { password: _, tenant: __, ...result } = user;
    return result;
  }

  /**
   * Rotate the refresh token. Verifies the signed JWT, looks it up in the
   * DB by its hash, revokes it, and issues a fresh access+refresh pair.
   *
   * Reuse detection: if the presented token was already revoked, we treat
   * it as a token-theft signal and revoke every active refresh token for
   * the user (forcing re-login on every session).
   */
  async refreshToken(
    refreshToken: string,
    ip?: string,
    userAgent?: string,
  ): Promise<AuthResponseDto> {
    let payload: any;
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        algorithms: ['HS256'],
      });
    } catch (_err) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.type && payload.type !== 'user') {
      throw new UnauthorizedException('Invalid token type');
    }

    const tokenHash = this.hashToken(refreshToken);

    // Atomic claim: only one in-flight refresh call wins the rotation.
    // The previous flow read the row, checked revokedAt, then updated
    // separately — two parallel refreshes with the same cookie could
    // both pass that check and both mint a fresh pair (TOCTOU). The
    // conditional updateMany on `revokedAt: null` serializes them, and
    // the loser sees count===0 and falls into the replay branch below.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { revokedAt: new Date() },
    });

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!stored || stored.expiresAt <= new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (claimed.count === 0) {
      // The token was already revoked (legitimate rotation, logout, or
      // replay of a rotated-out token). Treat as a theft signal and
      // revoke the whole family so a stolen token can't keep minting.
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: stored.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        tenantId: true,
        tokenVersion: true,
        tenant: { select: { status: true } },
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User not found or inactive');
    }
    if (user.tenant?.status !== TenantStatus.ACTIVE) {
      throw new UnauthorizedException('Your restaurant account is not active');
    }

    // Refresh tokens must also respect tokenVersion revocation. Previously
    // a password reset bumped tokenVersion and expired the ACCESS tokens,
    // but a stolen refresh token could still mint fresh access tokens with
    // the new version stamp. Reject the refresh if the stamp in the token
    // predates the current version.
    const refreshVer = (payload as any).ver ?? 0;
    if (refreshVer !== user.tokenVersion) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Token has been revoked');
    }

    const { tenant: _t, tokenVersion: _ver, ...userForToken } = user;
    return this.generateTokens(userForToken, ip, userAgent);
  }

  async logout(userId: string, ip?: string, userAgent?: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tenantId: true },
    });
    if (user) {
      // Revoke every active refresh token, then audit.
      await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.logUserActivity(userId, user.tenantId, 'LOGOUT', ip, userAgent);
    }
    return { message: 'Logged out' };
  }

  private async generateTokens(
    user: UserResponseDto,
    ip?: string,
    userAgent?: string,
  ): Promise<AuthResponseDto> {
    // Read current tokenVersion so the access token carries the stamp the
    // JwtStrategy validates against. Bumping User.tokenVersion invalidates
    // every prior access token for that user.
    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { tokenVersion: true },
    });
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      type: 'user' as const,
      ver: row?.tokenVersion ?? 0,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      expiresIn: this.configService.get<string>('JWT_EXPIRES_IN') || '15m',
      algorithm: 'HS256',
    });

    const refreshExpiresIn =
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '30d';
    // jti makes the refresh token unique even when two issuances land in
    // the same second (same iat → same payload → same JWT bytes → same
    // tokenHash → P2002 on the unique constraint). The access token
    // doesn't need it because it isn't persisted server-side.
    const refreshToken = this.jwtService.sign(
      { ...payload, jti: randomBytes(8).toString('hex') },
      {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: refreshExpiresIn,
        algorithm: 'HS256',
      },
    );

    // Persist the hash so we can revoke/rotate server-side.
    const decoded: any = this.jwtService.decode(refreshToken);
    const expiresAt = new Date(decoded.exp * 1000);
    await this.prisma.refreshToken.create({
      data: {
        tokenHash: this.hashToken(refreshToken),
        userId: user.id,
        expiresAt,
        ip,
        userAgent,
      },
    });

    return {
      accessToken,
      refreshToken,
      user,
    };
  }

  async getProfile(userId: string): Promise<UserResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        tenantId: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }

  /**
   * Send password reset email
   * Generates a secure reset token and sends it via email
   */
  async forgotPassword(forgotPasswordDto: ForgotPasswordDto): Promise<{ message: string }> {
    const { email } = forgotPasswordDto;

    // Find user
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    // Don't reveal if user exists or not (security best practice)
    if (!user) {
      return {
        message: 'If an account with that email exists, a password reset link has been sent.',
      };
    }

    // Generate high-entropy reset token (sent via email in raw form, stored hashed)
    const rawToken = randomBytes(32).toString('hex');
    const resetTokenHash = this.hashToken(rawToken);
    const resetTokenExpiry = new Date();
    resetTokenExpiry.setHours(resetTokenExpiry.getHours() + 1); // Token valid for 1 hour

    // Store only the hash so a DB leak does not yield usable tokens
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetTokenHash,
        resetTokenExpiry,
      },
    });

    // Send password reset email with the raw token
    await this.emailService.sendPasswordResetEmail(user.email, rawToken);

    return {
      message: 'If an account with that email exists, a password reset link has been sent.',
    };
  }

  /**
   * Reset password using token
   */
  async resetPassword(resetPasswordDto: ResetPasswordDto): Promise<{ message: string }> {
    const { token, newPassword } = resetPasswordDto;

    // Lookup by the hash of the incoming token (constant-time-ish via unique index)
    const resetTokenHash = this.hashToken(token);
    const user = await this.prisma.user.findFirst({
      where: {
        resetTokenHash,
        resetTokenExpiry: {
          gt: new Date(), // Token not expired
        },
      },
      select: { id: true },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, this.bcryptCost());

    // Atomic consume: the update filters on `resetTokenHash` too, so two
    // concurrent requests with the same token can't both succeed. The first
    // transaction nulls the hash; the second one's updateMany sees zero
    // affected rows and we reject it as already-used. Without this guard
    // the race window between findFirst and update allowed the same token
    // to mint two password changes in parallel.
    //
    // We also revoke refresh tokens in the same transaction so a stolen
    // token can't mint fresh access tokens after the reset.
    const [updateResult] = await this.prisma.$transaction([
      this.prisma.user.updateMany({
        where: { id: user.id, resetTokenHash },
        data: {
          password: hashedPassword,
          resetTokenHash: null,
          resetTokenExpiry: null,
          tokenVersion: { increment: 1 },
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    if (updateResult.count === 0) {
      // Lost the race: another request already consumed this token.
      throw new BadRequestException('Invalid or expired reset token');
    }

    // Audit: reset-password successfully consumed a valid token. We had
    // to refetch tenantId because the initial findFirst only selected id
    // (to keep the constant-time guarantee tight).
    const tenantOnly = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { tenantId: true },
    });
    if (tenantOnly) {
      await this.logUserActivity(user.id, tenantOnly.tenantId, 'PASSWORD_RESET');
    }

    return {
      message: 'Password has been reset successfully',
    };
  }

  /**
   * Change password for authenticated user
   */
  async changePassword(
    userId: string,
    changePasswordDto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    const { currentPassword, newPassword } = changePasswordDto;

    // Get user with password
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);

    if (!isPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, this.bcryptCost());

    // Update password + bump tokenVersion + revoke refresh tokens so all
    // prior sessions (including on other devices) are force-logged-out.
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          password: hashedPassword,
          tokenVersion: { increment: 1 },
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    // Audit trail for incident response: who changed their password
    // when. Failure is swallowed because losing an audit entry shouldn't
    // block a successful password change.
    await this.logUserActivity(userId, user.tenantId, 'PASSWORD_CHANGED');

    return {
      message: 'Password changed successfully',
    };
  }

  /**
   * Generate a 6-digit verification code (uniformly distributed via crypto RNG).
   * Scope is per-user, so no cross-user uniqueness loop is needed.
   */
  private generateVerificationCode(): string {
    // 1,000,000 values → 0-999,999, formatted as 6 digits
    const n = randomBytes(4).readUInt32BE(0) % 1_000_000;
    return n.toString().padStart(6, '0');
  }

  /**
   * Send email verification code
   * Generates a 6-digit code, stores its sha256 hash, emails the raw code.
   */
  async sendEmailVerification(userId: string): Promise<{ message: string; codeExpiry: Date }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.emailVerified) {
      return {
        message: 'Email is already verified',
        codeExpiry: null,
      };
    }

    // Generate 6-digit verification code
    const verificationCode = this.generateVerificationCode();
    const codeExpires = new Date();
    codeExpires.setHours(codeExpires.getHours() + 1); // Code valid for 1 hour

    // Store only the hash so a DB leak does not yield usable codes
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationCodeHash: this.hashToken(verificationCode),
        emailVerificationCodeExpires: codeExpires,
      },
    });

    // Send verification email with raw code
    await this.emailService.sendEmailVerificationCode(
      user.email,
      verificationCode,
      `${user.firstName} ${user.lastName}`,
    );

    // Send in-app notification (without code - code is only in email)
    try {
      await this.notificationsService.createAndSend({
        title: 'E-posta Doğrulaması Gereklidir',
        message: 'E-posta adresinize gönderilen 6 haneli doğrulama kodunu kullanarak hesabınızı doğrulamanız gerekmektedir. Lütfen e-posta kutunuzu kontrol ediniz.',
        type: NotificationType.WARNING,
        userId: user.id,
        tenantId: user.tenantId,
        data: {
          action: 'EMAIL_VERIFICATION_REQUIRED',
          expiresAt: codeExpires.toISOString(),
        },
        expiresAt: codeExpires.toISOString(),
      });
    } catch (error) {
      // Log error but don't fail if notification sending fails
      this.logger.error('Failed to send verification notification', error as any);
    }

    return {
      message: 'Verification code sent successfully to your email',
      codeExpiry: codeExpires,
    };
  }

  /**
   * Verify email using 6-digit code, scoped to the account identified by email.
   */
  async verifyEmailWithCode(
    email: string,
    code: string,
  ): Promise<{ message: string; verified: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    // Constant-time hash comparison + atomic single-use consumption.
    // The previous implementation read the user, did a plain `!==` on
    // the hash (timing-attackable; an attacker can probe digit-by-digit
    // by measuring response time), and then ran a separate UPDATE. Two
    // concurrent /verify-email calls could both pass the check and
    // both run the update — letting a stolen code be redeemed twice
    // (matters less for email-verify than reset-password, but the
    // pattern should be consistent). `updateMany` with the hash as part
    // of the WHERE clause makes the consumption atomic; the first
    // request wins, the second sees `count === 0`.
    const submitted = this.hashToken(code);
    const submittedOk =
      !!user?.emailVerificationCodeHash &&
      Buffer.byteLength(user.emailVerificationCodeHash) === Buffer.byteLength(submitted) &&
      timingSafeEqual(
        Buffer.from(user.emailVerificationCodeHash),
        Buffer.from(submitted),
      );

    // Return the same error for "no user" and "bad code" so the endpoint cannot
    // be used to enumerate which emails are registered.
    if (
      !user ||
      !user.emailVerificationCodeExpires ||
      user.emailVerificationCodeExpires <= new Date() ||
      !submittedOk
    ) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    // Atomic claim: filter by the current hash so a concurrent verify
    // with the same code can't double-consume. `count === 0` means we
    // lost the race (or the row was mutated mid-flight) → reject.
    const consumed = await this.prisma.user.updateMany({
      where: { id: user.id, emailVerificationCodeHash: user.emailVerificationCodeHash },
      data: {
        emailVerified: true,
        emailVerificationCodeHash: null,
        emailVerificationCodeExpires: null,
      },
    });
    if (consumed.count === 0) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    // Send success notification
    try {
      await this.notificationsService.createAndSend({
        title: 'Email Başarıyla Doğrulandı',
        message: 'Email adresiniz başarıyla doğrulandı. Artık tüm özelliklere erişebilirsiniz.',
        type: NotificationType.SUCCESS,
        userId: user.id,
        tenantId: user.tenantId,
      });
    } catch (error) {
      // Log error but don't fail if notification sending fails
      this.logger.error('Failed to send verification success notification', error as any);
    }

    return {
      message: 'Email verified successfully',
      verified: true,
    };
  }

  /**
   * Mirror the tenant-status guard the password path enforces at
   * `validateUser` (auth.service.ts:437-439). The four social-auth
   * branches previously checked only `user.status`, letting a member
   * of a suspended/deleted tenant in via Google or Apple.
   */
  private async assertTenantActive(tenantId: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { status: true },
    });
    if (!tenant || tenant.status !== TenantStatus.ACTIVE) {
      throw new UnauthorizedException('Your restaurant account is not active');
    }
  }

  /**
   * Authenticate with Google OAuth
   * Verifies the Google token (ID token or access token) and creates/links user account
   */
  async googleAuth(googleAuthDto: GoogleAuthDto): Promise<AuthResponseDto> {
    const { credential } = googleAuthDto;

    let googleId: string;
    let email: string;
    let firstName: string;
    let lastName: string;

    try {
      // Try to verify as ID token first
      try {
        const ticket = await this.googleClient.verifyIdToken({
          idToken: credential,
          audience: this.configService.get<string>('GOOGLE_CLIENT_ID'),
        });

        const payload = ticket.getPayload();
        if (payload) {
          googleId = payload.sub;
          email = payload.email;
          firstName = payload.given_name || 'User';
          lastName = payload.family_name || '';
        }
      } catch (idTokenError) {
        // If ID token verification fails, treat the credential as an access
        // token. We must first verify the audience via the tokeninfo endpoint
        // — otherwise any valid Google access token issued for any OAuth
        // client could authenticate as that user here.
        const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
        const tokenInfoRes = await fetch(
          `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(credential)}`,
        );
        if (!tokenInfoRes.ok) {
          throw new UnauthorizedException('Invalid Google token');
        }
        const tokenInfo = (await tokenInfoRes.json()) as { aud?: string };
        if (!clientId || tokenInfo.aud !== clientId) {
          throw new UnauthorizedException('Google token not issued for this application');
        }

        const response = await fetch(
          `https://www.googleapis.com/oauth2/v3/userinfo`,
          {
            headers: { Authorization: `Bearer ${credential}` },
          },
        );

        if (!response.ok) {
          throw new UnauthorizedException('Invalid Google token');
        }

        const userInfo = await response.json();
        googleId = userInfo.sub;
        email = userInfo.email;
        firstName = userInfo.given_name || 'User';
        lastName = userInfo.family_name || '';
      }

      if (!email) {
        throw new BadRequestException('Email not provided by Google');
      }

      // Check if user exists by googleId
      let user = await this.prisma.user.findUnique({
        where: { googleId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          tenantId: true,
        },
      });

      if (user) {
        // User found by googleId - login
        if (user.status !== 'ACTIVE') {
          throw new UnauthorizedException('User account is inactive');
        }
        await this.assertTenantActive(user.tenantId);

        // Track Google login in Sentry — email omitted (PII scrub policy).
        Sentry.captureMessage('User logged in via Google', {
          level: 'info',
          tags: {
            event: 'user.login.google',
            role: user.role,
          },
          extra: {
            userId: user.id,
            tenantId: user.tenantId,
          },
        });

        return this.generateTokens(user);
      }

      // Check if user exists by email (account linking)
      const existingUserByEmail = await this.prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          tenantId: true,
          googleId: true,
        },
      });

      if (existingUserByEmail) {
        // Link Google account to existing user
        if (existingUserByEmail.status !== 'ACTIVE') {
          throw new UnauthorizedException('User account is inactive');
        }
        await this.assertTenantActive(existingUserByEmail.tenantId);

        user = await this.prisma.user.update({
          where: { id: existingUserByEmail.id },
          data: {
            googleId,
            authProvider: existingUserByEmail.googleId ? undefined : 'google',
            emailVerified: true, // Email is verified by Google
          },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            status: true,
            tenantId: true,
          },
        });

        // Track Google account linking in Sentry — email omitted.
        Sentry.captureMessage('Google account linked', {
          level: 'info',
          tags: {
            event: 'user.link.google',
            role: user.role,
          },
          extra: {
            userId: user.id,
            tenantId: user.tenantId,
          },
        });

        return this.generateTokens(user);
      }

      // New user - create tenant and user
      return this.createSocialAuthUser({
        email,
        firstName: firstName || 'User',
        lastName: lastName || '',
        googleId,
        authProvider: 'google',
      });
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Google auth error', error as any);
      throw new UnauthorizedException('Failed to authenticate with Google');
    }
  }

  /**
   * Authenticate with Apple Sign-In
   * Verifies the Apple identity token and creates/links user account
   */
  async appleAuth(appleAuthDto: AppleAuthDto): Promise<AuthResponseDto> {
    const { identityToken, firstName, lastName } = appleAuthDto;

    try {
      // Verify Apple identity token
      const applePayload = await appleSignin.verifyIdToken(identityToken, {
        audience: this.configService.get<string>('APPLE_CLIENT_ID'),
        ignoreExpiration: false,
      });

      const { sub: appleId, email } = applePayload;

      if (!email) {
        throw new BadRequestException('Email not provided by Apple');
      }

      // Check if user exists by appleId
      let user = await this.prisma.user.findUnique({
        where: { appleId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          tenantId: true,
        },
      });

      if (user) {
        // User found by appleId - login
        if (user.status !== 'ACTIVE') {
          throw new UnauthorizedException('User account is inactive');
        }
        await this.assertTenantActive(user.tenantId);

        // Track Apple login in Sentry — email omitted (PII scrub policy).
        Sentry.captureMessage('User logged in via Apple', {
          level: 'info',
          tags: {
            event: 'user.login.apple',
            role: user.role,
          },
          extra: {
            userId: user.id,
            tenantId: user.tenantId,
          },
        });

        return this.generateTokens(user);
      }

      // Check if user exists by email (account linking)
      const existingUserByEmail = await this.prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          tenantId: true,
          appleId: true,
        },
      });

      if (existingUserByEmail) {
        // Link Apple account to existing user
        if (existingUserByEmail.status !== 'ACTIVE') {
          throw new UnauthorizedException('User account is inactive');
        }
        await this.assertTenantActive(existingUserByEmail.tenantId);

        user = await this.prisma.user.update({
          where: { id: existingUserByEmail.id },
          data: {
            appleId,
            authProvider: existingUserByEmail.appleId ? undefined : 'apple',
            emailVerified: true, // Email is verified by Apple
          },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            status: true,
            tenantId: true,
          },
        });

        // Track Apple account linking in Sentry — email omitted.
        Sentry.captureMessage('Apple account linked', {
          level: 'info',
          tags: {
            event: 'user.link.apple',
            role: user.role,
          },
          extra: {
            userId: user.id,
            tenantId: user.tenantId,
          },
        });

        return this.generateTokens(user);
      }

      // New user - create tenant and user
      // Note: Apple only sends name on first sign-in
      return this.createSocialAuthUser({
        email,
        firstName: firstName || 'User',
        lastName: lastName || '',
        appleId,
        authProvider: 'apple',
      });
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('Apple auth error', error as any);
      throw new UnauthorizedException('Failed to authenticate with Apple');
    }
  }

  /**
   * Create a new user from social auth (Google/Apple)
   * Auto-creates tenant and subscribes to FREE plan
   */
  private async createSocialAuthUser(data: {
    email: string;
    firstName: string;
    lastName: string;
    googleId?: string;
    appleId?: string;
    authProvider: string;
  }): Promise<AuthResponseDto> {
    const { email, firstName, lastName, googleId, appleId, authProvider } = data;

    // Generate restaurant name from email or name
    const restaurantName = firstName && firstName !== 'User'
      ? `${firstName}'s Restaurant`
      : `Restaurant ${email.split('@')[0]}`;

    const baseSubdomain = restaurantName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const subdomain = await this.allocateSubdomain(baseSubdomain);

    // Get FREE plan
    const freePlan = await this.prisma.subscriptionPlan.findUnique({
      where: { name: 'FREE' },
    });

    if (!freePlan) {
      throw new ResourceNotFoundException('FREE subscription plan');
    }

    const now = new Date();
    const currentPeriodEnd = new Date(now);
    currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 10);

    // Tenant + subscription + user in one transaction so a failure midway
    // does not leave orphaned rows.
    let user;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            name: restaurantName,
            subdomain,
            currentPlanId: freePlan.id,
          },
        });
        await tx.subscription.create({
          data: {
            tenantId: tenant.id,
            planId: freePlan.id,
            status: 'ACTIVE',
            billingCycle: 'MONTHLY',
            paymentProvider: PaymentProvider.PAYTR,
            startDate: now,
            currentPeriodStart: now,
            currentPeriodEnd,
            isTrialPeriod: false,
            amount: 0,
            currency: freePlan.currency,
            cancelAtPeriodEnd: false,
          },
        });
        return tx.user.create({
          data: {
            email,
            password: '',
            firstName,
            lastName,
            role: UserRole.ADMIN,
            tenantId: tenant.id,
            googleId,
            appleId,
            authProvider,
            emailVerified: true,
          },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            tenantId: true,
          },
        });
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ResourceAlreadyExistsException('Tenant', 'subdomain', subdomain);
      }
      throw err;
    }

    // Track new social auth registration in Sentry — email + name omitted
    // (PII scrub policy). restaurantName is business metadata not PII.
    Sentry.captureMessage('New user registered via social auth', {
      level: 'info',
      tags: {
        event: 'user.register.social',
        provider: authProvider,
        role: user.role,
      },
      extra: {
        userId: user.id,
        tenantId: user.tenantId,
        restaurantName,
      },
    });

    return this.generateTokens(user);
  }
}
