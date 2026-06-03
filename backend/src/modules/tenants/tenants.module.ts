import { Module } from "@nestjs/common";
import { TenantsService } from "./tenants.service";
import { TenantsController } from "./tenants.controller";
import { PrismaModule } from "../../prisma/prisma.module";
import { EntitlementsModule } from "../entitlements/entitlements.module";

@Module({
  imports: [PrismaModule, EntitlementsModule],
  controllers: [TenantsController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
