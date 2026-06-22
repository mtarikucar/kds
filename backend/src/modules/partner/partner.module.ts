import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
import { PartnerApiKeyService } from "./partner-api-key.service";
import { PartnerApiKeysController } from "./controllers/partner-api-keys.controller";

/**
 * Partner Display API — third-party/remote-screen integration.
 *
 * Phase 3: tenant-issued API keys (ADMIN management). Later phases add the
 * screen-session mint/refresh machine endpoints and the /display surface.
 */
@Module({
  imports: [PrismaModule, SubscriptionsModule],
  controllers: [PartnerApiKeysController],
  providers: [PartnerApiKeyService],
  exports: [PartnerApiKeyService],
})
export class PartnerModule {}
