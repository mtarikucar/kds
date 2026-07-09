import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { CashDrawerController } from "./cash-drawer.controller";
import { CashDrawerService } from "./cash-drawer.service";
import { CashierSessionService } from "./cashier-session.service";

/**
 * v2.8.99 — cash drawer movement management with DRAFT/APPROVED/REJECTED
 * audit trail. See cash-drawer.service.ts for the type→approval mapping
 * and z-reports.service.ts for the reconciliation filter.
 */
@Module({
  imports: [PrismaModule],
  controllers: [CashDrawerController],
  providers: [CashDrawerService, CashierSessionService],
  exports: [CashDrawerService, CashierSessionService],
})
export class CashDrawerModule {}
