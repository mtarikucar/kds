import { Module } from "@nestjs/common";
import { ContactController } from "./contact.controller";
import { ContactService } from "./contact.service";
import { MailerService } from "./mailer.service";
import { PrismaModule } from "../../prisma/prisma.module";
// SuperAdminModule re-exports SuperAdminGuard (and the JwtModule
// configured with SUPERADMIN_JWT_SECRET) so iter-58's contact admin
// moderation endpoints can verify superadmin tokens. Same wiring iter-51
// added to PublicStatsModule.
import { SuperAdminModule } from "../superadmin/superadmin.module";

@Module({
  imports: [PrismaModule, SuperAdminModule],
  controllers: [ContactController],
  providers: [ContactService, MailerService],
})
export class ContactModule {}
