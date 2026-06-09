import { Global, Module } from '@nestjs/common';
import { CORE_PROVISIONING_PORT } from '../core-contracts/provisioning/tenant-provisioning.port';
import { REFERRAL_DIRECTORY_PORT } from '../core-contracts/referral/referral-directory.port';
import { HttpCoreProvisioningClient } from './http-core-provisioning.client';
import { ReferralDirectoryService } from '../modules/marketing/acl/referral-directory.service';

/**
 * Phase-5 composition root for the two cross-context ports — the standalone
 * successor of the monorepo's ProvisioningModule. Marked `@Global` (mirroring
 * the source) so call sites inject the tokens without a module import.
 *
 * Ownership after the split:
 *   - CORE_PROVISIONING_PORT  → HttpCoreProvisioningClient (network client;
 *     core's TenantProvisioningService is exposed at
 *     `${CORE_SERVICE_URL}/api/internal/provisioning/*`)
 *   - REFERRAL_DIRECTORY_PORT → ReferralDirectoryService (marketing OWNS the
 *     impl; it is additionally exposed to core over
 *     POST /api/internal/referral/resolve — see InternalApiModule)
 */
@Global()
@Module({
  providers: [
    HttpCoreProvisioningClient,
    ReferralDirectoryService,
    { provide: CORE_PROVISIONING_PORT, useExisting: HttpCoreProvisioningClient },
    { provide: REFERRAL_DIRECTORY_PORT, useExisting: ReferralDirectoryService },
  ],
  // ReferralDirectoryService is exported by class as well: the internal HTTP
  // surface (InternalReferralController) wraps the owned impl directly.
  exports: [CORE_PROVISIONING_PORT, REFERRAL_DIRECTORY_PORT, ReferralDirectoryService],
})
export class ProvisioningClientModule {}
