import { Global, Logger, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CORE_PROVISIONING_PORT } from "../../core-contracts/provisioning/tenant-provisioning.port";
import { TenantProvisioningService } from "./tenant-provisioning.service";
import { REFERRAL_DIRECTORY_PORT } from "../../core-contracts/referral/referral-directory.port";
import {
  HttpReferralDirectoryClient,
  NoopReferralDirectoryClient,
} from "./http-referral-directory.client";
import { InternalProvisioningController } from "./internal-provisioning.controller";
import { InternalServiceTokenGuard } from "../../common/guards/internal-service-token.guard";

/**
 * Phase-5 composition root for the two cross-context ports that decouple
 * marketing from core. Marked `@Global` so core callers can inject a token
 * without a NestJS module import.
 *
 * Ownership after the physical split:
 *   - CORE_PROVISIONING_PORT  → TenantProvisioningService (core-owned impl,
 *     additionally exposed to the kds-marketing service over HTTP via
 *     InternalProvisioningController).
 *   - REFERRAL_DIRECTORY_PORT → the impl (ReferralDirectoryService) shipped
 *     with the kds-marketing service; core binds a network client instead.
 *     Transport is selected by env, exactly as the runbook prescribes: HTTP
 *     client when MARKETING_SERVICE_URL is set, a log-once noop otherwise.
 *     Call sites inject the token, not the impl, so they are unaffected.
 */
@Global()
@Module({
  controllers: [InternalProvisioningController],
  providers: [
    TenantProvisioningService,
    InternalServiceTokenGuard,
    { provide: CORE_PROVISIONING_PORT, useExisting: TenantProvisioningService },
    {
      provide: REFERRAL_DIRECTORY_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const baseUrl = config
          .get<string>("MARKETING_SERVICE_URL")
          ?.trim()
          .replace(/\/+$/, "");
        if (!baseUrl) {
          return new NoopReferralDirectoryClient();
        }
        const token = config.get<string>("INTERNAL_SERVICE_TOKEN");
        if (!token) {
          // Still bind the HTTP client (the marketing side will 401 and the
          // client degrades to null), but make the misconfiguration loud.
          new Logger("ProvisioningModule").warn(
            "MARKETING_SERVICE_URL is set but INTERNAL_SERVICE_TOKEN is not — referral resolves will be rejected by the marketing service",
          );
        }
        return new HttpReferralDirectoryClient(baseUrl, token);
      },
    },
  ],
  exports: [CORE_PROVISIONING_PORT, REFERRAL_DIRECTORY_PORT],
})
export class ProvisioningModule {}
