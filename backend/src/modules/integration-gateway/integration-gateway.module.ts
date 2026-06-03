import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { IntegrationService } from "./integration.service";
import { IntegrationController } from "./integration.controller";
import { YemeksepetiAdapter } from "./adapters/yemeksepeti.adapter";
import { GetirAdapter } from "./adapters/getir.adapter";
import { TrendyolYemekAdapter } from "./adapters/trendyol-yemek.adapter";

/**
 * Integration gateway module. Adapter classes are registered as plain
 * providers so they can be DI-resolved + unit-tested; the catalog of
 * IntegrationProviderDef rows in the DB names them by id.
 */
@Module({
  imports: [PrismaModule],
  controllers: [IntegrationController],
  providers: [
    IntegrationService,
    YemeksepetiAdapter,
    GetirAdapter,
    TrendyolYemekAdapter,
  ],
  exports: [
    IntegrationService,
    YemeksepetiAdapter,
    GetirAdapter,
    TrendyolYemekAdapter,
  ],
})
export class IntegrationGatewayModule {}
