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
import { MarketplaceModule } from "../marketplace/marketplace.module";
import { LocalStrategy } from "./strategies/local.strategy";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { RolesGuard } from "./guards/roles.guard";
import { TenantGuard } from "./guards/tenant.guard";
import { BranchGuard } from "./guards/branch.guard";
import { EntitlementGuard } from "../entitlements/entitlement.guard";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [
    PassportModule,
    forwardRef(() => NotificationsModule),
    // DemoService comps the demo tenant's licence + integrations through the
    // real purchase path, so the marketplace service must resolve here.
    // forwardRef because MarketplaceModule's graph reaches back into auth.
    forwardRef(() => MarketplaceModule),
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
    // v3.3.0 — SubscriptionStatusGuard is gone: the core product is free, so
    // there is no subscription state left to lock on.
    //
    // Nothing replaces it, deliberately. The global lockout lever already
    // exists one layer up: JwtStrategy.validate rejects any request whose
    // tenant is not ACTIVE with a 401, on every authenticated route, from a
    // LIVE read. A second guard here would be a weaker duplicate — cached,
    // allowlist-scoped, and able to disagree with the check that already ran.
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
