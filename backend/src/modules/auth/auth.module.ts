import { Module, forwardRef } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { TokenService } from "./services/token.service";
import { PasswordService } from "./services/password.service";
import { EmailVerificationService } from "./services/email-verification.service";
import { AuthProvisioningService } from "./services/auth-provisioning.service";
import { DemoService } from "../demo/demo.service";
import { LocalStrategy } from "./strategies/local.strategy";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { RolesGuard } from "./guards/roles.guard";
import { TenantGuard } from "./guards/tenant.guard";
import { BranchGuard } from "./guards/branch.guard";
import { TenantStatusGuard } from "./guards/tenant-status.guard";
import { EntitlementGuard } from "../entitlements/entitlement.guard";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [
    PassportModule,
    forwardRef(() => NotificationsModule),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>("JWT_SECRET"),
        signOptions: {
          expiresIn: configService.get<string>("JWT_EXPIRES_IN") || "7d",
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    // Extracted auth sub-services. TokenService + PasswordService take
    // @Optional MetricsService; EmailVerificationService is wired through
    // the same NotificationsModule forwardRef the AuthService used.
    TokenService,
    PasswordService,
    EmailVerificationService,
    AuthProvisioningService,
    DemoService,
    LocalStrategy,
    JwtStrategy,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: TenantGuard,
    },
    // BranchGuard depends on req.user.tenantId being set, so it must
    // run after TenantGuard. Routes opt out via @SkipBranchScope()
    // (billing, marketing, branch CRUD, /me, /auth/*).
    {
      provide: APP_GUARD,
      useClass: BranchGuard,
    },
    // v3.3.0 — the core product is free, so there is no subscription state
    // left to lock on and SubscriptionStatusGuard is gone. What replaces it in
    // the same position is the ONLY global lockout lever the app has:
    // TenantGuard resolves the tenant without ever reading Tenant.status, so
    // without this a superadmin suspension would do nothing at all — which
    // matters more, not less, once the product costs nothing to use.
    {
      provide: APP_GUARD,
      useClass: TenantStatusGuard,
    },
    // Entitlement gates. Registered globally so the @RequiresFeature /
    // @RequiresIntegration aliases resolve everywhere the old PlanFeatureGuard
    // did; routes without a decorator pass straight through.
    {
      provide: APP_GUARD,
      useClass: EntitlementGuard,
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
