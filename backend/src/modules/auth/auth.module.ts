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
import { LocalStrategy } from "./strategies/local.strategy";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { RolesGuard } from "./guards/roles.guard";
import { TenantGuard } from "./guards/tenant.guard";
import { BranchGuard } from "./guards/branch.guard";
import { SubscriptionStatusGuard } from "../subscriptions/guards/subscription-status.guard";
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
    // Onboarding-trial lock — runs LAST (after Jwt/Tenant/Branch set
    // req.user.tenantId). A tenant with no live subscription (TRIAL_ENDED /
    // EXPIRED) is gated to the plan-selection + checkout flow.
    {
      provide: APP_GUARD,
      useClass: SubscriptionStatusGuard,
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
