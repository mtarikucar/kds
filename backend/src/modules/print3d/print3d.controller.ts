import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { UserRole } from "../../common/constants/roles.enum";
import { Print3dService } from "./print3d.service";

/**
 * Kiracı yüzeyi.
 *
 * @SkipBranchScope YOK ve olmamalı: /v1/checkout de şube kapsamlı ve SPA zaten
 * X-Branch-Id gönderiyor. frontend/src/lib/api.ts'teki tenant-wide önek
 * listesine de ekleme YAPILMAZ.
 */
@ApiTags("Print3D")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER)
@Controller("v1/print3d")
export class Print3dController {
  constructor(private readonly print3d: Print3dService) {}

  @Get("offer")
  @ApiOperation({
    summary: "3D baskı figür teklifi — canlı fiyat + üretim ortağı rozeti",
  })
  offer() {
    return this.print3d.getOffer();
  }
}
