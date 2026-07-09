import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { ExpensesController } from "./expenses.controller";
import { ExpensesService } from "./expenses.service";

/**
 * Operating-expense (OpEx) ledger. Feeds the P&L report (revenue − COGS − OpEx
 * → net profit). See modules/reports for the consolidated P&L.
 */
@Module({
  imports: [PrismaModule],
  controllers: [ExpensesController],
  providers: [ExpensesService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
