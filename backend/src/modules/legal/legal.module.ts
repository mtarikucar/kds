import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { PrismaModule } from "../../prisma/prisma.module";
import { LegalDocumentsService } from "./services/legal-documents.service";
import { ConsentService } from "./services/consent.service";
import { LegalPublicController } from "./controllers/legal-public.controller";
import { LegalAdminController } from "./controllers/legal-admin.controller";

/**
 * Legal docs + consents module. Two surfaces:
 *   - LegalPublicController: read-only document fetch for /legal/* pages
 *     and checkout page consent labels.
 *   - LegalAdminController: SuperAdmin publishes new versions — guarded
 *     by SuperAdminGuard, which needs JwtService scoped with the
 *     SUPERADMIN_JWT_SECRET (the guard is instantiated per importing
 *     module so each module must wire its own JwtModule binding).
 *
 * Exports ConsentService so PaymentsService can gate create-intent on
 * "did the user just check all three checkboxes?".
 */
@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>("SUPERADMIN_JWT_SECRET"),
        signOptions: { expiresIn: "1h", algorithm: "HS256" as const },
        verifyOptions: { algorithms: ["HS256"] },
      }),
    }),
  ],
  providers: [LegalDocumentsService, ConsentService],
  controllers: [LegalPublicController, LegalAdminController],
  exports: [ConsentService, LegalDocumentsService],
})
export class LegalModule {}
