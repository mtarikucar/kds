import { Global, Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { CreditService } from "./credit.service";
import { CreditsController } from "./credits.controller";

/**
 * @Global() for the same reason LicensingModule is: credits are spent by the
 * menu AI studio and the SMS sender, which live in unrelated feature modules,
 * and a module that forgets to import this would fail at boot rather than
 * silently — but only after someone noticed. Global removes the question.
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [CreditsController],
  providers: [CreditService],
  exports: [CreditService],
})
export class CreditsModule {}
