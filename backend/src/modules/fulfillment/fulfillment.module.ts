import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { CatalogModule } from "../catalog/catalog.module";
import { SuperAdminModule } from "../superadmin/superadmin.module";
import { ShipmentService } from "./shipment.service";
import { WarrantyService } from "./warranty.service";
import { InstallationService } from "./installation.service";
import {
  InstallationController,
  SuperadminInstallationController,
  WarrantyController,
  SuperadminShipmentsController,
} from "./fulfillment.controller";

@Module({
  imports: [PrismaModule, CatalogModule, SuperAdminModule],
  controllers: [
    InstallationController,
    SuperadminInstallationController,
    WarrantyController,
    SuperadminShipmentsController,
  ],
  providers: [ShipmentService, WarrantyService, InstallationService],
  exports: [ShipmentService, WarrantyService, InstallationService],
})
export class FulfillmentModule {}
