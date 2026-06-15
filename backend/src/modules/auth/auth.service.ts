import {
  Injectable,
  Inject,
  forwardRef,
  Logger,
  Optional,
  UnauthorizedException,
  BadRequestException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { MetricsService } from "../../common/metrics/metrics.service";
import * as bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import * as appleSignin from "apple-signin-auth";
import * as Sentry from "@sentry/node";
import { addDays } from "date-fns";
import { PrismaService } from "../../prisma/prisma.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { GoogleAuthDto, AppleAuthDto } from "./dto/social-auth.dto";
import { AuthResponseDto, UserResponseDto } from "./dto/auth-response.dto";
import {
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
} from "./dto/password-reset.dto";
import { UserRole } from "../../common/constants/roles.enum";
import { TenantStatus } from "../../common/constants/subscription.enum";
import { EmailService } from "../../common/services/email.service";
import { NotificationsService } from "../notifications/notifications.service";
import { NotificationType } from "../notifications/dto/create-notification.dto";
import {
  ResourceAlreadyExistsException,
  ResourceNotFoundException,
  InvalidCredentialsException,
  ValidationException,
} from "../../common/exceptions";
import { Prisma } from "@prisma/client";
import { TokenService } from "./services/token.service";
import { PasswordService } from "./services/password.service";
import { EmailVerificationService } from "./services/email-verification.service";
import { AuthProvisioningService } from "./services/auth-provisioning.service";
import { resolvePrimaryBranchId } from "./services/resolve-primary-branch";

/**
 * AuthService — thin facade over the extracted auth sub-services:
 *   - TokenService              (access/refresh mint + rotate + verify)
 *   - PasswordService           (hash/compare, validateUser, forgot/reset/change)
 *   - EmailVerificationService  (6-digit code lifecycle)
 *   - AuthProvisioningService   (tenant + subscription + branch + user creation)
 *
 * Public method signatures are unchanged — controller / LocalStrategy /
 * users.service callers are untouched. The orchestration that must stay
 * here (register's scenario routing, login auditing, social-auth provider
 * verification) keeps its exact call order and transaction boundaries.
 *
 * Sub-services are injected when available (DI) and otherwise self-constructed
 * from the primitives so the service stays constructable bare in unit tests
 * (`new AuthService(prisma, jwt, config, email, notifications, metrics)`).
 */
@Injectable()
export class AuthService {
  // Use NestJS Logger so messages flow through the structured-JSON pipeline
  // configured in main.ts. The previous `console.error` callsites bypassed
  // it, writing plain-text lines into the middle of the JSON log stream —
  // which breaks parsers (Loki/Datadog) that expect one valid JSON object
  // per line and skips any PII redaction the logger pipeline has.
  private readonly logger = new Logger(AuthService.name);
  private googleClient: OAuth2Client;

  private readonly tokens: TokenService;
  private readonly passwords: PasswordService;
  private readonly emailVerification: EmailVerificationService;
  private readonly provisioning: AuthProvisioningService;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private emailService: EmailService,
    @Inject(forwardRef(() => NotificationsService))
    private notificationsService: NotificationsService,
    // Optional so unit tests constructing AuthService bare keep working and
    // auth never depends on the metrics registry being wired.
    @Optional() private metrics?: MetricsService,
    // Extracted sub-services. @Optional so the facade is still constructable
    // bare in unit tests; when DI doesn't supply them, build them in-place
    // from the same primitives (identical wiring to the module providers).
    @Optional() tokenService?: TokenService,
    @Optional() passwordService?: PasswordService,
    @Optional() emailVerificationService?: EmailVerificationService,
    @Optional() provisioningService?: AuthProvisioningService,
  ) {
    // Initialize Google OAuth client
    this.googleClient = new OAuth2Client(
      this.configService.get<string>("GOOGLE_CLIENT_ID"),
    );

    this.tokens =
      tokenService ??
      new TokenService(
        this.prisma,
        this.jwtService,
        this.configService,
        this.metrics,
      );
    this.passwords =
      passwordService ??
      new PasswordService(
        this.prisma,
        this.configService,
        this.emailService,
        this.metrics,
      );
    this.emailVerification =
      emailVerificationService ??
      new EmailVerificationService(
        this.prisma,
        this.emailService,
        this.notificationsService,
      );
    this.provisioning =
      provisioningService ?? new AuthProvisioningService(this.prisma);
  }

  /**
   * Delegate subdomain allocation to the provisioning service. Kept as a
   * private method so existing tests that `jest.spyOn(service, 'allocateSubdomain')`
   * continue to work against the facade.
   */
  private async allocateSubdomain(base: string): Promise<string> {
    return this.provisioning.allocateSubdomain(base);
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
      this.logger.error("Failed to log user activity", error as any);
    }
  }

  async register(registerDto: RegisterDto): Promise<AuthResponseDto> {
    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: registerDto.email },
    });

    if (existingUser) {
      throw new ResourceAlreadyExistsException(
        "User",
        "email",
        registerDto.email,
      );
    }

    // Validate registration data
    const hasRestaurantName = !!registerDto.restaurantName;
    const hasTenantId = !!registerDto.tenantId;

    // Mutual exclusion: cannot provide both
    if (hasRestaurantName && hasTenantId) {
      throw new ValidationException(
        "Cannot provide both restaurantName and tenantId",
      );
    }

    // One of them must be provided
    if (!hasRestaurantName && !hasTenantId) {
      throw new ValidationException(
        "Either restaurantName or tenantId must be provided",
      );
    }

    let tenantId: string;
    let userRole = registerDto.role;
    // v3.0.0 — every user lands with a primaryBranchId. Scenario 1
    // (new restaurant) creates the Main branch in the same transaction
    // and assigns it to the ADMIN. Scenario 2 (join) resolves to the
    // tenant's first active branch — the DB CHECK constraint refuses
    // to mint a WAITER/KITCHEN/COURIER without one, so a tenant with
    // zero active branches cannot accept new staff signups.
    let primaryBranchId: string;

    // Hash the password up front so both scenarios can create the user
    // inside their own transaction. Scenario 1 must create the user in
    // the SAME tx as the tenant+subscription+branch — otherwise a crash
    // between a (committed) tenant tx and a separate user tx would leave
    // an orphan tenant (no users) holding a consumed subdomain.
    const hashedPassword = await bcrypt.hash(
      registerDto.password,
      this.passwords.bcryptCost(),
    );

    // Determine user status: ADMIN creating restaurant = ACTIVE, others
    // = PENDING_APPROVAL. Depends only on the scenario, so compute it
    // here where both transactions can read it.
    const userStatus = hasRestaurantName ? "ACTIVE" : "PENDING_APPROVAL";

    // Populated by whichever scenario runs below.
    let user: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      role: any;
      status: string;
      tenantId: string;
      primaryBranchId: string;
    };

    // Scenario 1: Creating a new restaurant (ADMIN only)
    if (hasRestaurantName) {
      // If creating a restaurant, role must be ADMIN (or default to ADMIN)
      if (userRole && userRole !== UserRole.ADMIN) {
        throw new ValidationException(
          "Only ADMIN role is allowed when creating a new restaurant",
        );
      }
      userRole = UserRole.ADMIN;

      const baseSubdomain = registerDto.restaurantName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      const finalSubdomain = await this.allocateSubdomain(baseSubdomain);

      // Every new tenant gets a 14-day BUSINESS trial — the top-tier
      // plan with every premium feature open — at zero charge. Trial is
      // a one-time per-tenant benefit; the SchedulerService.expireTrials
      // job downgrades the tenant to FREE at trialEnd. We need the
      // BUSINESS plan here, not FREE, so the new tenant boots into a
      // fully-featured workspace from the first dashboard load.
      const businessPlan = await this.provisioning.loadBusinessPlanOrThrow();

      // Tenant + TRIALING BUSINESS subscription must be created
      // atomically so other modules never observe a tenant without a
      // matching subscription.
      const now = new Date();
      const trialEnd = addDays(now, businessPlan.trialDays);

      // Seed `featureOverrides` with the BUSINESS plan's flag set so
      // PlanFeatureGuard's fallback path resolves correctly during the
      // first ~30 seconds while the entitlement engine projector is
      // still warming up.
      const planFeatureOverrides =
        this.provisioning.buildPlanFeatureOverrides(businessPlan);

      try {
        const txResult = await this.prisma.$transaction(async (tx) =>
          // Tenant + subscription + branch + ADMIN user are all written
          // inside THIS single transaction. The caller owns the tx so a
          // user.create failure rolls back the tenant — no orphan tenant
          // / consumed subdomain.
          this.provisioning.provisionNewTenantWithAdmin(tx, {
            restaurantName: registerDto.restaurantName,
            finalSubdomain,
            businessPlan,
            planFeatureOverrides,
            now,
            trialEnd,
            userParams: {
              email: registerDto.email,
              hashedPassword,
              firstName: registerDto.firstName,
              lastName: registerDto.lastName,
              userRole: userRole!,
              userStatus,
            },
          }),
        );
        tenantId = txResult.tenant.id;
        primaryBranchId = txResult.mainBranchId;
        user = txResult.user;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          throw new ResourceAlreadyExistsException(
            "Tenant",
            "subdomain",
            finalSubdomain,
          );
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
        throw new ResourceNotFoundException("Tenant", registerDto.tenantId);
      }

      // Cannot join as ADMIN (ADMIN creates their own restaurant)
      if (userRole === UserRole.ADMIN) {
        throw new ValidationException(
          "Cannot join existing restaurant as ADMIN. ADMIN must create their own restaurant.",
        );
      }

      // Default to WAITER if no role provided
      if (!userRole) {
        userRole = UserRole.WAITER;
      }

      tenantId = registerDto.tenantId;

      // v3.0.0 — every joining user lands on the tenant's first
      // active branch. The DB CHECK constraint on users rejects
      // restricted roles without a primaryBranchId, so a tenant
      // without an active branch (impossible under normal ops, but
      // possible if every branch was archived) cannot accept staff
      // signups. Surface that as a clear error rather than letting
      // the user.create call crash on the constraint.
      const firstBranch = await this.prisma.branch.findFirst({
        where: { tenantId, status: "active" },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (!firstBranch) {
        throw new ValidationException(
          "Tenant has no active branch — signup is blocked until an admin restores at least one.",
        );
      }
      primaryBranchId = firstBranch.id;

      // Scenario 2 joins a pre-existing tenant, so there is no
      // orphan-tenant risk: the tenant already has rows (its creator).
      // Create the user (+ allow-list row for restricted roles) in its
      // own transaction — same shape as before, just routed through the
      // shared helper. The CHECK constraint
      // `users_restricted_role_requires_primary_branch` makes the
      // primaryBranchId for WAITER/KITCHEN/COURIER load-bearing — we
      // set it on every signup.
      user = await this.prisma.$transaction((tx) =>
        this.provisioning.createUserWithAssignment(
          tx,
          tenantId,
          primaryBranchId,
          {
            email: registerDto.email,
            hashedPassword,
            firstName: registerDto.firstName,
            lastName: registerDto.lastName,
            userRole: userRole!,
            userStatus,
          },
        ),
      );
    }

    // Send email verification code automatically after registration
    try {
      await this.sendEmailVerification(user.id);
    } catch (error) {
      // Log error but don't fail registration if email sending fails
      this.logger.error("Failed to send verification email", error as any);
    }

    // If user is pending approval, notify admins and return without tokens
    if (userStatus === "PENDING_APPROVAL") {
      try {
        await this.notificationsService.notifyAdmins(tenantId, {
          title: "Yeni Kullanıcı Onay Bekliyor",
          message: `${user.firstName} ${user.lastName} (${user.email}) hesap onayı bekliyor.`,
          type: NotificationType.WARNING,
          data: {
            action: "USER_APPROVAL_REQUIRED",
            userId: user.id,
          },
        });
      } catch (error) {
        this.logger.error(
          "Failed to notify admins about pending user",
          error as any,
        );
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
          primaryBranchId: user.primaryBranchId,
          // Restricted roles register with exactly one allow-list
          // row (their primary branch); ADMIN / MANAGER joining is
          // refused above so the empty-list path doesn't apply here.
          allowedBranchIds: [primaryBranchId],
        },
        accessToken: null,
        refreshToken: null,
        pendingApproval: true,
        message: "Kayıt başarılı. Hesabınız yönetici onayı bekliyor.",
      } as any;
    }

    // Track successful registration in Sentry. We deliberately exclude
    // email + firstName + lastName from both the message body and the
    // `extra` payload — sentry.config.ts's beforeSend only scrubs known
    // user.email/ip_address fields, NOT arbitrary message text or extras,
    // so anything we interpolate here would persist in Sentry's long-term
    // retention. GDPR/KVKK violation for a TR-resident SaaS. userId is
    // enough to join back to the app DB when debugging.
    Sentry.captureMessage("New user registered", {
      level: "info",
      tags: {
        event: "user.register",
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

  async login(
    loginDto: LoginDto,
    ip?: string,
    userAgent?: string,
  ): Promise<AuthResponseDto> {
    const user = await this.validateUser(loginDto.email, loginDto.password);

    if (!user) {
      // Track failed login attempt. Like in `register`, we keep the
      // submitted email out of Sentry — message body and extra fields
      // bypass beforeSend's user.email scrubber, so plaintext emails
      // would land in long-term retention.
      Sentry.captureMessage("Failed login attempt", {
        level: "warning",
        tags: {
          event: "user.login.failed",
        },
      });

      // Log failed login attempt if we can identify the user
      const existingUser = await this.prisma.user.findUnique({
        where: { email: loginDto.email },
        select: { id: true, tenantId: true },
      });
      if (existingUser) {
        await this.logUserActivity(
          existingUser.id,
          existingUser.tenantId,
          "LOGIN_FAILED",
          ip,
          userAgent,
        );
      }

      throw new InvalidCredentialsException();
    }

    // Track successful login in Sentry. Email excluded — see register/login
    // failed comments above.
    Sentry.captureMessage("User logged in", {
      level: "info",
      tags: {
        event: "user.login",
        role: user.role,
      },
      extra: {
        userId: user.id,
        tenantId: user.tenantId,
      },
    });

    // Log successful login activity
    await this.logUserActivity(user.id, user.tenantId, "LOGIN", ip, userAgent);

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

  async validateUser(email: string, password: string): Promise<any> {
    return this.passwords.validateUser(email, password);
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
    return this.tokens.refreshToken(refreshToken, ip, userAgent);
  }

  async logout(
    userId: string,
    ip?: string,
    userAgent?: string,
  ): Promise<{ message: string }> {
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
      await this.logUserActivity(
        userId,
        user.tenantId,
        "LOGOUT",
        ip,
        userAgent,
      );
    }
    return { message: "Logged out" };
  }

  private async generateTokens(
    user: Omit<UserResponseDto, "primaryBranchId" | "allowedBranchIds">,
    ip?: string,
    userAgent?: string,
  ): Promise<AuthResponseDto> {
    return this.tokens.generateTokens(user, ip, userAgent);
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
        primaryBranchId: true,
        branchAssignments: { select: { branchId: true } },
      },
    });

    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    const { branchAssignments, ...rest } = user;
    // Mirror token.service: an owner ADMIN/MANAGER with a null primaryBranchId
    // (pre-v3.0.0, never backfilled) must still receive a concrete home
    // branch here, or the SPA's /me refetch re-nulls branchScopeStore and
    // re-bricks every branch-scoped request after the login fallback fixed it.
    const primaryBranchId = await resolvePrimaryBranchId(
      this.prisma,
      user.tenantId,
      user.primaryBranchId,
    );
    return {
      ...rest,
      primaryBranchId,
      allowedBranchIds: branchAssignments.map((a) => a.branchId),
    };
  }

  /**
   * Send password reset email
   * Generates a secure reset token and sends it via email
   */
  async forgotPassword(
    forgotPasswordDto: ForgotPasswordDto,
  ): Promise<{ message: string }> {
    return this.passwords.forgotPassword(forgotPasswordDto);
  }

  /**
   * Reset password using token
   */
  async resetPassword(
    resetPasswordDto: ResetPasswordDto,
  ): Promise<{ message: string }> {
    return this.passwords.resetPassword(resetPasswordDto);
  }

  /**
   * Change password for authenticated user
   */
  async changePassword(
    userId: string,
    changePasswordDto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    return this.passwords.changePassword(userId, changePasswordDto);
  }

  /**
   * Send email verification code
   * Generates a 6-digit code, stores its sha256 hash, emails the raw code.
   */
  async sendEmailVerification(
    userId: string,
  ): Promise<{ message: string; codeExpiry: Date }> {
    return this.emailVerification.sendEmailVerification(userId);
  }

  /**
   * Verify email using 6-digit code, scoped to the account identified by email.
   */
  async verifyEmailWithCode(
    email: string,
    code: string,
  ): Promise<{ message: string; verified: boolean }> {
    return this.emailVerification.verifyEmailWithCode(email, code);
  }

  /**
   * Mirror the tenant-status guard the password path enforces at
   * `validateUser`. The four social-auth branches previously checked only
   * `user.status`, letting a member of a suspended/deleted tenant in via
   * Google or Apple.
   */
  private async assertTenantActive(tenantId: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { status: true },
    });
    if (!tenant || tenant.status !== TenantStatus.ACTIVE) {
      throw new UnauthorizedException("Your restaurant account is not active");
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
          audience: this.configService.get<string>("GOOGLE_CLIENT_ID"),
        });

        const payload = ticket.getPayload();
        if (payload) {
          googleId = payload.sub;
          email = payload.email;
          firstName = payload.given_name || "User";
          lastName = payload.family_name || "";
        }
      } catch (idTokenError) {
        // If ID token verification fails, treat the credential as an access
        // token. We must first verify the audience via the tokeninfo endpoint
        // — otherwise any valid Google access token issued for any OAuth
        // client could authenticate as that user here.
        const clientId = this.configService.get<string>("GOOGLE_CLIENT_ID");
        const tokenInfoRes = await fetch(
          `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(credential)}`,
        );
        if (!tokenInfoRes.ok) {
          throw new UnauthorizedException("Invalid Google token");
        }
        const tokenInfo = (await tokenInfoRes.json()) as { aud?: string };
        if (!clientId || tokenInfo.aud !== clientId) {
          throw new UnauthorizedException(
            "Google token not issued for this application",
          );
        }

        const response = await fetch(
          `https://www.googleapis.com/oauth2/v3/userinfo`,
          {
            headers: { Authorization: `Bearer ${credential}` },
          },
        );

        if (!response.ok) {
          throw new UnauthorizedException("Invalid Google token");
        }

        const userInfo = await response.json();
        googleId = userInfo.sub;
        email = userInfo.email;
        firstName = userInfo.given_name || "User";
        lastName = userInfo.family_name || "";
      }

      if (!email) {
        throw new BadRequestException("Email not provided by Google");
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
        if (user.status !== "ACTIVE") {
          throw new UnauthorizedException("User account is inactive");
        }
        await this.assertTenantActive(user.tenantId);

        // Track Google login in Sentry — email omitted (PII scrub policy).
        Sentry.captureMessage("User logged in via Google", {
          level: "info",
          tags: {
            event: "user.login.google",
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
        if (existingUserByEmail.status !== "ACTIVE") {
          throw new UnauthorizedException("User account is inactive");
        }
        await this.assertTenantActive(existingUserByEmail.tenantId);

        user = await this.prisma.user.update({
          where: { id: existingUserByEmail.id },
          data: {
            googleId,
            authProvider: existingUserByEmail.googleId ? undefined : "google",
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
        Sentry.captureMessage("Google account linked", {
          level: "info",
          tags: {
            event: "user.link.google",
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
        firstName: firstName || "User",
        lastName: lastName || "",
        googleId,
        authProvider: "google",
      });
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.logger.error("Google auth error", error as any);
      throw new UnauthorizedException("Failed to authenticate with Google");
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
        audience: this.configService.get<string>("APPLE_CLIENT_ID"),
        ignoreExpiration: false,
      });

      const { sub: appleId, email } = applePayload;

      if (!email) {
        throw new BadRequestException("Email not provided by Apple");
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
        if (user.status !== "ACTIVE") {
          throw new UnauthorizedException("User account is inactive");
        }
        await this.assertTenantActive(user.tenantId);

        // Track Apple login in Sentry — email omitted (PII scrub policy).
        Sentry.captureMessage("User logged in via Apple", {
          level: "info",
          tags: {
            event: "user.login.apple",
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
        if (existingUserByEmail.status !== "ACTIVE") {
          throw new UnauthorizedException("User account is inactive");
        }
        await this.assertTenantActive(existingUserByEmail.tenantId);

        user = await this.prisma.user.update({
          where: { id: existingUserByEmail.id },
          data: {
            appleId,
            authProvider: existingUserByEmail.appleId ? undefined : "apple",
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
        Sentry.captureMessage("Apple account linked", {
          level: "info",
          tags: {
            event: "user.link.apple",
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
        firstName: firstName || "User",
        lastName: lastName || "",
        appleId,
        authProvider: "apple",
      });
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.logger.error("Apple auth error", error as any);
      throw new UnauthorizedException("Failed to authenticate with Apple");
    }
  }

  /**
   * Create a new user from social auth (Google/Apple). Delegates provisioning
   * to AuthProvisioningService (tenant + BUSINESS trial + Main branch + ADMIN
   * user in one transaction) and mints tokens for the created user. Kept as a
   * private method so existing tests calling it via `(service as any)` and
   * spying on `allocateSubdomain` continue to work.
   */
  private async createSocialAuthUser(data: {
    email: string;
    firstName: string;
    lastName: string;
    googleId?: string;
    appleId?: string;
    authProvider: string;
  }): Promise<AuthResponseDto> {
    const user = await this.provisioning.createSocialAuthUser(data);
    return this.generateTokens(user);
  }
}
