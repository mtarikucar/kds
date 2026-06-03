import { Global, Module } from "@nestjs/common";
import { CORE_PROVISIONING_PORT } from "../../core-contracts/provisioning/tenant-provisioning.port";
import { TenantProvisioningService } from "./tenant-provisioning.service";
import { REFERRAL_DIRECTORY_PORT } from "../../core-contracts/referral/referral-directory.port";
import { ReferralDirectoryService } from "../marketing/acl/referral-directory.service";

/**
 * Phase-1 composition root for the two cross-context ports that decouple
 * marketing from core. Marked `@Global` so either side can inject a token
 * without a NestJS module import (which would re-introduce the very coupling
 * this refactor removes).
 *
 * Ownership:
 *   - CORE_PROVISIONING_PORT  → TenantProvisioningService  (core-owned; writes tenant/user/subscription)
 *   - REFERRAL_DIRECTORY_PORT → ReferralDirectoryService   (marketing-owned; reads marketing_users)
 *
 * The referral impl physically lives under marketing/acl/ and is only *bound*
 * here. At the Phase-5 physical split each impl is replaced by a network client
 * on the consuming side and the real impl ships with its owning service, so
 * this module shrinks to wiring core's local provisioning impl + a referral
 * HTTP client.
 */
@Global()
@Module({
  providers: [
    TenantProvisioningService,
    ReferralDirectoryService,
    { provide: CORE_PROVISIONING_PORT, useExisting: TenantProvisioningService },
    { provide: REFERRAL_DIRECTORY_PORT, useExisting: ReferralDirectoryService },
  ],
  exports: [CORE_PROVISIONING_PORT, REFERRAL_DIRECTORY_PORT],
})
export class ProvisioningModule {}
