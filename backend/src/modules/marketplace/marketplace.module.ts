import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { SuperAdminModule } from "../superadmin/superadmin.module";
import { AddOnCatalogService } from "./addon-catalog.service";
import { TenantMarketplaceService } from "./tenant-marketplace.service";
import { TenantAddOnSweeperService } from "./tenant-addon-sweeper.service";
import { MarketplaceController } from "./marketplace.controller";
import { SuperadminAddOnsController } from "./superadmin-addons.controller";

/**
 * Marketplace module — catalog of add-ons + tenant purchase/cancel flow.
 *
 * SuperAdminModule is imported so the SuperAdminGuard can resolve. Outbox
 * comes via the @Global OutboxModule, so no explicit import is needed.
 */
@Module({
  imports: [PrismaModule, SuperAdminModule],
  controllers: [MarketplaceController, SuperadminAddOnsController],
  providers: [
    AddOnCatalogService,
    TenantMarketplaceService,
    TenantAddOnSweeperService,
  ],
  exports: [AddOnCatalogService, TenantMarketplaceService],
})
export class MarketplaceModule {}
